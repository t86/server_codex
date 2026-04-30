import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const id = customAlphabet(alphabet, 18);

export function threadId() {
  return `thr_${id()}`;
}

export function messageId() {
  return `msg_${id()}`;
}

export function runId() {
  return `run_${id()}`;
}
