import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, Loader2, Download } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import { useAuthStore } from "../../stores/authStore";
import * as pdfjsLib from "pdfjs-dist";

// Set up the worker - use local copy bundled via vite-plugin-static-copy
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PageCanvasProps {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}

function PageCanvas({ pdf, pageNumber, scale }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const renderPage = async () => {
      if (!canvasRef.current) return;
      setIsRendering(true);

      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

        // Use device pixel ratio for crisp rendering on HiDPI displays
        const devicePixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * devicePixelRatio });

        // Set actual canvas size for crisp rendering
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Scale down via CSS for proper display size
        canvas.style.width = `${viewport.width / devicePixelRatio}px`;
        canvas.style.height = `${viewport.height / devicePixelRatio}px`;

        await page.render({
          canvasContext: context,
          viewport,
        }).promise;

        if (!cancelled) {
          setIsRendering(false);
        }
      } catch (error) {
        console.error(`Error rendering page ${pageNumber}:`, error);
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, scale]);

  return (
    <div className="relative mb-4 shadow-lg bg-white">
      <canvas ref={canvasRef} className="block" />
      {isRendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      )}
      <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
        {pageNumber}
      </div>
    </div>
  );
}

export default function PDFViewer() {
  const { pdfUrl, compileErrors } = useEditorStore();
  const { token } = useAuthStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load PDF when URL changes
  useEffect(() => {
    if (!pdfUrl) {
      setPdf(null);
      setNumPages(0);
      setError(null);
      return;
    }

    const loadPdf = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch PDF with authentication
        const response = await fetch(pdfUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const loadedPdf = await pdfjsLib.getDocument({ data: arrayBuffer })
          .promise;
        setPdf(loadedPdf);
        setNumPages(loadedPdf.numPages);
      } catch (error) {
        console.error("Error loading PDF:", error);
        setError(error instanceof Error ? error.message : "Failed to load PDF");
      } finally {
        setIsLoading(false);
      }
    };

    loadPdf();
  }, [pdfUrl, token]);

  const zoomIn = useCallback(() => setScale((s) => Math.min(s + 0.25, 3)), []);
  const zoomOut = useCallback(
    () => setScale((s) => Math.max(s - 0.25, 0.5)),
    [],
  );

  const handleDownload = useCallback(async () => {
    if (!pdfUrl) return;

    try {
      const response = await fetch(pdfUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to download PDF");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Extract filename from URL or use default
      const filename = pdfUrl.split("/").pop() || "document.pdf";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading PDF:", error);
    }
  }, [pdfUrl, token]);

  // Handle keyboard shortcuts for zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        zoomOut();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomIn, zoomOut]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin mb-2" />
        <p>Loading PDF...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500">
        <div className="max-w-md p-4 text-center">
          <h3 className="text-lg font-medium text-red-600 mb-2">
            Error Loading PDF
          </h3>
          <p className="text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500">
        {compileErrors.length > 0 ? (
          <div className="max-w-md p-4">
            <h3 className="text-lg font-medium text-red-600 mb-2">
              Compilation Errors
            </h3>
            <div className="space-y-2 max-h-96 overflow-auto">
              {compileErrors.map((err, index) => (
                <div
                  key={index}
                  className="text-sm bg-red-50 border border-red-200 rounded p-2"
                >
                  {err.file && <span className="font-medium">{err.file}</span>}
                  {err.line && (
                    <span className="text-red-600">:{err.line}</span>
                  )}
                  <p className="text-red-700">{err.message}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="mb-2">No PDF to display</p>
            <p className="text-sm">Click "Compile" to generate a PDF</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-10 bg-white border-b border-gray-200 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Zoom out (Ctrl+-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-sm text-gray-600 min-w-[4rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Zoom in (Ctrl++)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{numPages} pages</span>
          <button
            onClick={handleDownload}
            className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Download PDF"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* PDF Pages - Continuous Scroll */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex flex-col items-center p-4 bg-gray-200"
      >
        {pdf &&
          Array.from({ length: numPages }, (_, i) => (
            <PageCanvas
              key={i + 1}
              pdf={pdf}
              pageNumber={i + 1}
              scale={scale}
            />
          ))}
      </div>
    </div>
  );
}
