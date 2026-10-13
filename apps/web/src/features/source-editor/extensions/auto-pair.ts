import { keymap } from '@codemirror/view'
import { buildInsertInputHandler } from '../utils/autocomplete-helpers'
import { Compartment, Prec, TransactionSpec } from '@codemirror/state'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'

const autoPairConf = new Compartment()

export const autoPair = ({
  autoPairDelimiters,
}: {
  autoPairDelimiters: boolean
}) => autoPairConf.of(autoPairDelimiters ? extension : [])

export const setAutoPair = (autoPairDelimiters: boolean): TransactionSpec => {
  return {
    effects: autoPairConf.reconfigure(autoPairDelimiters ? extension : []),
  }
}

/**
 * The built-in closeBrackets extension and closeBrackets keymap.
 */
const extension = [
  // language-specific opening-bracket inserts (runs before closeBrackets)
  Prec.high(buildInsertInputHandler),
  closeBrackets(),
  // NOTE: using Prec.highest as this needs to run before the default Backspace handler
  Prec.highest(keymap.of(closeBracketsKeymap)),
]
