// @vitest-environment jsdom
// Ported from Overleaf services/web/test/frontend/features/source-editor/languages/latex/latex-linter.test.ts (AGPL-3.0).

import type { Diagnostic } from '@codemirror/lint'
import { assert, describe, it } from 'vitest'
import { errorsToDiagnostics } from '@/features/source-editor/languages/latex/linter/errors-to-diagnostics'
import LintWorker from '@/features/source-editor/languages/latex/linter/latex-linter.worker'
import { mergeCompatibleOverlappingDiagnostics } from '@/features/source-editor/languages/latex/linter/merge-overlapping-diagnostics'

const { Parse } = new LintWorker()

describe('LatexLinter', () => {
  it('should accept a simple environment match without errors', () => {
    const { errors } = Parse('\\begin{foo}\n' + '\\end{foo}\n')
    assert.equal(errors.length, 0)
  })

  it('should accept an invalid \\it* command', () => {
    const { errors } = Parse('\\it*hello\n' + '\\bye\n')
    assert.equal(errors.length, 0)
  })

  it('should accept newcomlumntype', () => {
    const { errors } = Parse(
      'hello\n' +
        '\\newcolumntype{M}[1]{>{\\begin{varwidth}[t]{#1}}l<{\\end{varwidth}}}\n' +
        'bye'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept newenvironment', () => {
    const { errors } = Parse(
      '\\newenvironment{Algorithm}[2][tbh]%\n' +
        '{\\begin{myalgo}[#1]\n' +
        '\\centering\n' +
        '\\part{title}\\begin{minipage}{#2}\n' +
        '\\begin{algorithm}[H]}%\n' +
        '{\\end{algorithm}\n' +
        '\\end{minipage}\n' +
        '\\end{myalgo}}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept newenvironment II', () => {
    const { errors } = Parse(
      '\\newenvironment{claimproof}[1][\\myproofname]{\\begin{proof}[#1]\\renewcommand*{\\qedsymbol}{\\(\\diamondsuit\\)}}{\\end{proof}}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept superscript inside math mode', () => {
    const { errors } = Parse('this is $a^b$ test')
    assert.equal(errors.length, 0)
  })

  it('should accept subscript inside math mode', () => {
    const { errors } = Parse('this is $a_b$ test')
    assert.equal(errors.length, 0)
  })

  it('should return an error for superscript outside math mode', () => {
    const { errors } = Parse('this is a^b test')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].text, '^ must be inside math mode')
    assert.equal(errors[0].type, 'error')
  })

  it('should return an error subscript outside math mode', () => {
    const { errors } = Parse('this is a_b test')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].text, '_ must be inside math mode')
    assert.equal(errors[0].type, 'error')
  })

  it('should accept math mode inside \\hbox outside math mode', () => {
    const { errors } = Parse('this is \\hbox{for every $bar$}')
    assert.equal(errors.length, 0)
  })

  it('should accept math mode inside \\hbox inside math mode', () => {
    const { errors } = Parse('this is $foo = \\hbox{for every $bar$}$ test')
    assert.equal(errors.length, 0)
  })

  it('should accept math mode inside \\text inside math mode', () => {
    const { errors } = Parse('this is $foo = \\text{for every $bar$}$ test')
    assert.equal(errors.length, 0)
  })

  it('should accept verbatim', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\begin{verbatim}\n' +
        'this is verbatim\n' +
        '\\end{verbatim}\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept verbatim with environment inside', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\begin{verbatim}\n' +
        'this is verbatim\n' +
        '\\begin{foo}\n' +
        'this is verbatim too\n' +
        '\\end{foo}\n' +
        '\\end{verbatim}\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept verbatim with \\begin{verbatim} inside', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\begin{verbatim}\n' +
        'this is verbatim\n' +
        '\\begin{verbatim}\n' +
        'this is verbatim too\n' +
        '\\end{verbatim}\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept equation', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\begin{equation}\n' +
        '\\alpha^2 + b^2 = c^2\n' +
        '\\end{equation}\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept $$', () => {
    const { errors } = Parse(
      'this is text\n' +
        '$$\n' +
        '\\alpha^2 + b^2 = c^2\n' +
        '$$\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept $', () => {
    const { errors } = Parse(
      'this is text $\\alpha^2 + b^2 = c^2$' + ' this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\[', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\[\n' +
        '\\alpha^2 + b^2 = c^2\n' +
        '\\]\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\(', () => {
    const { errors } = Parse(
      'this is text \\(\\alpha^2 + b^2 = c^2\\)' + ' this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\begin{foo}', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\begin{foo}\n' +
        'this is foo\n' +
        '\\end{foo}\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\begin{foo_bar}', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\begin{foo_bar}\n' +
        'this is foo bar\n' +
        '\\end{foo_bar}\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\begin{foo} \\begin{bar}', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\begin{foo}\n' +
        '\\begin{bar}\n' +
        '\\begin{baz}\n' +
        'this is foo bar baz\n' +
        '\\end{baz}\n' +
        '\\end{bar}\n' +
        '\\end{foo}\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\verb|...|', () => {
    const { errors } = Parse('this is text \\verb|hello| and more\n')
    assert.equal(errors.length, 0)
  })

  it('should accept \\verb|...| with special chars', () => {
    const { errors } = Parse('this is text \\verb|{}()^_@$xhello| and more\n')
    assert.equal(errors.length, 0)
  })

  it('should accept \\url|...|', () => {
    const { errors } = Parse(
      'this is text \\url|http://www.overleaf.com/| and more\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\url{...}', () => {
    const { errors } = Parse(
      'this is text \\url{http://www.overleaf.com/} and more\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\url{...} with % chars', () => {
    const { errors } = Parse(
      'this is text \\url{http://www.overleaf.com/hello%20world} and more\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\href{...}{...}', () => {
    const { errors } = Parse(
      'this is text \\href{http://www.overleaf.com/}{test} and more\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept \\href{...}{...} with dollarsign in url', () => {
    const { errors } = Parse(
      'this is text \\href{http://www.overleaf.com/foo=$bar}{test} and more\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should not accept \\href|...|{...}', () => {
    const { errors } = Parse(
      'this is text \\href|http://www.overleaf.com|{test} and more\n'
    )
    assert.equal(errors.length, 1)
    assert.equal(errors[0].text, 'invalid href command')
    assert.equal(errors[0].type, 'error')
  })

  it('should catch error in text argument of \\href{...}{...}', () => {
    const { errors } = Parse(
      'this is text \\href{http://www.overleaf.com/foo=$bar}{i have made an $error} and more\n'
    )
    assert.equal(errors.length, 2)
    assert.equal(errors[0].text, 'unclosed $ found at close group }')
    assert.equal(errors[0].type, 'error')
    assert.equal(errors[1].text, 'unexpected close group } after $')
    assert.equal(errors[1].type, 'error')
  })

  it('should accept \\left( and \\right)', () => {
    const { errors } = Parse('math $\\left( x + y \\right) = y + x$ and more\n')
    assert.equal(errors.length, 0)
  })

  it('should accept \\left( and \\right.', () => {
    const { errors } = Parse('math $\\left( x + y \\right. = y + x$ and more\n')
    assert.equal(errors.length, 0)
  })

  it('should accept \\left. and \\right)', () => {
    const { errors } = Parse('math $\\left. x + y \\right) = y + x$ and more\n')
    assert.equal(errors.length, 0)
  })

  it('should accept complex math nesting', () => {
    const { errors } = Parse(
      'math $\\left( {x + {y + z} + x} \\right\\} = \\left[y + x\\right.$ and more\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept math toggling $a$$b$', () => {
    const { errors } = Parse('math $a$$b$ and more\n')
    assert.equal(errors.length, 0)
  })

  it('should accept math toggling $$display$$$inline$', () => {
    const { errors } = Parse('math $$display$$$inline$ and more\n')
    assert.equal(errors.length, 0)
  })

  it('should accept math definition commands', () => {
    const { errors } = Parse(
      '\\let\\originalleft\\left\n' +
        '\\let\\originalright\\right\n' +
        '\\renewcommand{\\left}{\\mathopen{}\\mathclose\\bgroup\\originalleft}\n' +
        '\\renewcommand{\\right}{\\aftergroup\\egroup\\originalright}\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept math reflectbox commands', () => {
    const { errors } = Parse('$\\reflectbox{$alpha$}$\n')
    assert.equal(errors.length, 0)
  })

  it('should accept math scalebox commands', () => {
    const { errors } = Parse('$\\scalebox{2}{$alpha$}$\n')
    assert.equal(errors.length, 0)
  })

  it('should accept math rotatebox commands', () => {
    const { errors } = Parse('$\\rotatebox{60}{$alpha$}$\n')
    assert.equal(errors.length, 0)
  })

  it('should accept math resizebox commands', () => {
    const { errors } = Parse('$\\resizebox{2}{3}{$alpha$}$\n')
    assert.equal(errors.length, 0)
  })

  it('should accept all math box commands', () => {
    const { errors } = Parse(
      '\\[ \\left(\n' +
        '\\shiftright{2ex}{\\raisebox{-2ex}{\\scalebox{2}{$\\ast$}}}\n' +
        '\\reflectbox{$ddots$}\n' +
        '\\right). \\]\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept math tag commands', () => {
    const { errors } = Parse('$\\tag{$alpha$}$\n')
    assert.equal(errors.length, 0)
  })

  it('should accept math tag* commands', () => {
    const { errors } = Parse(
      '\\begin{align}\n\\pi=3 \\tag*{\\(\\dagger\\)}\n\\end{align}\n'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept math tag* commands with $ math mode', () => {
    const { errors } = Parse('$\\tag*{$abc$}$\n')
    assert.equal(errors.length, 0)
  })

  it('should accept math \\def commands', () => {
    const { errors } = Parse(
      '\\def\\peb[#1]{{\\left\\lfloor #1\\right\\rfloor}}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept math \\def commands II', () => {
    const { errors } = Parse('\\def\\foo#1{\\gamma^#1}')
    assert.equal(errors.length, 0)
  })

  it('should accept DeclareMathOperator', () => {
    const { errors } = Parse('\\DeclareMathOperator{\\var}{\\Delta^2\\!}')
    assert.equal(errors.length, 0)
  })

  it('should accept DeclarePairedDelimiter', () => {
    const { errors } = Parse(
      '\\DeclarePairedDelimiter{\\spro}{\\left(}{\\right)^{\\ast}}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept nested user-defined math commands', () => {
    const { errors } = Parse(
      '$\\foo{$\\alpha \\bar{x^y}{\\cite{hello}}$}{\\gamma}{$\\beta\\baz{\\alpha}$}{\\cite{foo}}$'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept nested user-defined math commands II', () => {
    const { errors } = Parse(
      '\\foo{$\\alpha \\bar{x^y}{\\cite{hello}}$}{\\gamma}{$\\beta\\baz{\\alpha}$}{\\cite{foo}}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept newenvironment with multiple parameters', () => {
    const { errors } = Parse(
      '\\newenvironment{case}[1][\\textsc{Case}]\n' +
        '{\\begin{trivlist}\\item[\\hskip \\labelsep {\\textsc{#1}}]}{\\end{trivlist}}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept newenvironment with no parameters', () => {
    const { errors } = Parse(
      '\\newenvironment{case}{\\begin{trivlist}\\item[\\hskip \\labelsep {\\textsc{#1}}]}{\\end{trivlist}}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept tikzfeynman', () => {
    const { errors } = Parse(
      '\\begin{equation*}\n' +
        '\\feynmandiagram[layered layout, medium, horizontal=a to b] {\n' +
        ' a [particle=\\(H\\)] -- [scalar] b [dot] -- [photon] f1 [particle=\\(W^{\\pm}\\)],\n' +
        ' b -- [boson, edge label=\\(W^{\\mp}\\)] c [dot],\n' +
        ' c -- [fermion] f2 [particle=\\(f\\)],\n' +
        " c -- [anti fermion] f3 [particle=\\(\\bar{f}'\\)],\n" +
        ' };this is a change\n' +
        '\\end{equation*}'
    )
    assert.equal(errors.length, 0)
  })

  it('should return errors from malformed \\end', () => {
    const { errors } = Parse(
      'this is text\n' +
        '\\begin{foo}\n' +
        '\\begin{bar}\n' +
        'this is foo bar baz\n' +
        '\\end{bar\n' +
        '\\end{foo}\n' +
        'this is more text\n'
    )
    assert.equal(errors.length, 4)
    assert.equal(errors[0].text, 'unclosed \\begin{bar} found at \\end{foo}')
    assert.equal(errors[1].text, 'invalid environment command \\end{bar')
    assert.equal(errors[2].text, 'unclosed open group { found at \\end{foo}')
    assert.equal(errors[3].text, 'unexpected \\end{foo} after \\begin{bar}')
  })

  it('should accept \\newcommand*', () => {
    const { errors } = Parse('\\newcommand*{\\foo}{\\bar}')
    assert.equal(errors.length, 0)
  })

  it('should accept incomplete \\newcommand*', () => {
    const { errors } = Parse('\\newcommand*{\\beq' + '}')
    assert.equal(errors.length, 0)
  })

  it('should accept a plain hyperref command', () => {
    const { errors } = Parse('\\hyperref{http://www.overleaf.com/}')
    assert.equal(errors.length, 0)
  })

  it('should accept a hyperref command with underscores in the url ', () => {
    const { errors } = Parse('\\hyperref{http://www.overleaf.com/my_page.html}')
    assert.equal(errors.length, 0)
  })

  it('should accept a hyperref command with category, name and text arguments ', () => {
    const { errors } = Parse(
      '\\hyperref{http://www.overleaf.com/}{category}{name}{text}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept an underscore in a hyperref label', () => {
    const { errors } = Parse('\\hyperref[foo_bar]{foo bar}')
    assert.equal(errors.length, 0)
  })

  it('should reject a $ in a hyperref label', () => {
    const { errors } = Parse('\\hyperref[foo$bar]{foo bar}')
    assert.equal(errors.length, 1)
  })

  it('should reject an unclosed hyperref label', () => {
    const { errors } = Parse('\\hyperref[foo_bar{foo bar}')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].text, 'invalid hyperref label')
  })

  it('should accept a hyperref command without an optional argument', () => {
    const { errors } = Parse('{\\hyperref{hello}}')
    assert.equal(errors.length, 0)
  })

  it('should accept a hyperref command without an optional argument and multiple other arguments', () => {
    const { errors } = Parse('{\\hyperref{}{}{fig411}}')
    assert.equal(errors.length, 0)
  })

  it('should accept a hyperref command without an optional argument in an unclosed group', () => {
    const { errors } = Parse('{\\hyperref{}{}{fig411}')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].text, 'unclosed group {')
  })

  it('should accept documentclass with no options', () => {
    const { errors } = Parse('\\documentclass{article}')
    assert.equal(errors.length, 0)
  })

  it('should accept documentclass with options', () => {
    const { errors } = Parse('\\documentclass[a4paper]{article}')
    assert.equal(errors.length, 0)
  })

  it('should accept documentclass with underscore in options', () => {
    const { errors } = Parse(
      '\\documentclass[my_custom_document_class_option]{my-custom-class}'
    )
    assert.equal(errors.length, 0)
  })

  it('should accept a documentclass with braces in options', () => {
    const { errors } = Parse(
      '\\documentclass[a4paper,margin={1in,0.5in}]{article}'
    )
    assert.equal(errors.length, 0)
  })

  it('should reject documentclass with unbalanced braces in options', () => {
    const { errors } = Parse('\\documentclass[foo={bar]{article}')
    assert.equal(errors.length, 2)
    assert.equal(errors[0].text, 'invalid documentclass option')
    assert.equal(errors[1].text, 'unexpected close group }')
  })

  it('should reject documentclass with out of order braces in options', () => {
    const { errors } = Parse('\\documentclass[foo=}bar{]{article}')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].text, 'invalid documentclass option')
  })

  // %novalidate
  // %begin novalidate
  // %end novalidate
  // \begin{foo}
  // \begin{new_theorem}
  // \begin{foo   invalid environment command
  // \newcommand{\foo}{\bar}
  // \newcommand[1]{\foo}{\bar #1}
  // \renewcommand...
  // \def
  // \DeclareRobustCommand
  // \newcolumntype
  // \newenvironment
  // \renewenvironment
  // \verb|....|
  // \url|...|
  // \url{...}
  // \left(   \right)
  // \left.   \right.
  // $...$
  // $$....$$
  // $...$$...$
  // $a^b$ vs a^b
  // $$a^b$$ vs a^b
  // Matrix for envs for {} left/right \[ \] \( \) $ $$ begin end
  // begin equation
  // align(*)
  // equation(*)
  // ]
  // array(*)
  // eqnarray(*)
  // split
  // aligned
  // cases
  // pmatrix
  // gathered
  // matrix
  // alignedat
  // smallmatrix
  // subarray
  // vmatrix
  // shortintertext

  it('should return math mode contexts', () => {
    const { contexts } = Parse(
      '\\begin{document}\n' +
        '$$\n' +
        '\\begin{array}\n' +
        '\\left( \\foo{bar} \\right] & 2\n' +
        '\\end{array}\n' +
        '$$\n' +
        '\\end{document}'
    )
    assert.equal(contexts.length, 1)
    assert.equal(contexts[0].type, 'math')
    assert.equal(contexts[0].range.start.row, 1)
    assert.equal(contexts[0].range.start.column, 0)
    assert.equal(contexts[0].range.end?.row, 5)
    assert.equal(contexts[0].range.end?.column, 2)
  })

  it('should remove error when cursor is inside incomplete command', () => {
    const { errors } = Parse('\\begin{}')
    const diagnostics = errorsToDiagnostics(errors, 7, 9)
    assert.equal(errors.length, 1)
    assert.equal(diagnostics.length, 0)
  })

  it('should show an error when cursor is outside incomplete command', () => {
    const { errors } = Parse('\\begin{}')
    const diagnostics = errorsToDiagnostics(errors, 6, 9)
    assert.equal(errors.length, 1)
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].from, 0)
    assert.equal(diagnostics[0].to, 6)
  })

  it('should adjust an error range when the cursor is inside that range', () => {
    const { errors } = Parse('\\begin{}')
    const diagnostics = errorsToDiagnostics(errors, 4, 7)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].startPos, 0)
    assert.equal(errors[0].endPos, 7)
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].from, 0)
    assert.equal(diagnostics[0].to, 4)
  })

  it('should reject an error when part of the error range is outside of the document boundaries', () => {
    const { errors } = Parse('\\begin{}')
    const diagnostics = errorsToDiagnostics(errors, 8, 6)
    assert.equal(errors.length, 1)
    assert.equal(diagnostics.length, 0)
  })

  it('should merge two overlapping identical diagnostics', () => {
    const diagnostics: Diagnostic[] = [
      {
        from: 0,
        to: 2,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 1,
        to: 3,
        message: 'Message 1',
        severity: 'error',
      },
    ]
    const mergedDiagnostics = mergeCompatibleOverlappingDiagnostics(diagnostics)
    assert.deepEqual(mergedDiagnostics, [
      {
        from: 0,
        to: 3,
        message: 'Message 1',
        severity: 'error',
      },
    ])
  })

  it('should merge two touching identical diagnostics', () => {
    const diagnostics: Diagnostic[] = [
      {
        from: 0,
        to: 2,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 2,
        to: 3,
        message: 'Message 1',
        severity: 'error',
      },
    ]
    const mergedDiagnostics = mergeCompatibleOverlappingDiagnostics(diagnostics)
    assert.deepEqual(mergedDiagnostics, [
      {
        from: 0,
        to: 3,
        message: 'Message 1',
        severity: 'error',
      },
    ])
  })

  it('should not merge two overlapping diagnostics with different messages', () => {
    const diagnostics: Diagnostic[] = [
      {
        from: 0,
        to: 2,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 1,
        to: 3,
        message: 'Message 2',
        severity: 'error',
      },
    ]
    const mergedDiagnostics = mergeCompatibleOverlappingDiagnostics(diagnostics)
    assert.deepEqual(diagnostics, mergedDiagnostics)
  })

  it('should not merge two overlapping diagnostics with different severities', () => {
    const diagnostics: Diagnostic[] = [
      {
        from: 0,
        to: 2,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 1,
        to: 3,
        message: 'Message 1',
        severity: 'warning',
      },
    ]
    const mergedDiagnostics = mergeCompatibleOverlappingDiagnostics(diagnostics)
    assert.deepEqual(diagnostics, mergedDiagnostics)
  })

  it('should merge three overlapping identical diagnostics', () => {
    const diagnostics: Diagnostic[] = [
      {
        from: 0,
        to: 2,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 1,
        to: 4,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 3,
        to: 5,
        message: 'Message 1',
        severity: 'error',
      },
    ]
    const mergedDiagnostics = mergeCompatibleOverlappingDiagnostics(diagnostics)
    assert.deepEqual(mergedDiagnostics, [
      {
        from: 0,
        to: 5,
        message: 'Message 1',
        severity: 'error',
      },
    ])
  })

  it('should merge two separate sets of overlapping identical diagnostics', () => {
    const diagnostics: Diagnostic[] = [
      {
        from: 0,
        to: 2,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 2,
        to: 3,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 2,
        to: 5,
        message: 'Message 2',
        severity: 'error',
      },
      {
        from: 4,
        to: 6,
        message: 'Message 3',
        severity: 'error',
      },
      {
        from: 5,
        to: 7,
        message: 'Message 3',
        severity: 'error',
      },
    ]
    const mergedDiagnostics = mergeCompatibleOverlappingDiagnostics(diagnostics)
    assert.deepEqual(mergedDiagnostics, [
      {
        from: 0,
        to: 3,
        message: 'Message 1',
        severity: 'error',
      },
      {
        from: 2,
        to: 5,
        message: 'Message 2',
        severity: 'error',
      },
      {
        from: 4,
        to: 7,
        message: 'Message 3',
        severity: 'error',
      },
    ])
  })
})
