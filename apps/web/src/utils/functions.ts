export function callFnsInSequence<
  Args extends Array<any>,
  Fn extends ((...args: Args) => void) | undefined,
>(...fns: Fn[]) {
  return (...args: Args) => {
    for (const fn of fns) fn?.(...args)
  }
}
