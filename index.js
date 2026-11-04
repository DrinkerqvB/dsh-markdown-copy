/**
 * Host half of `@local/dsh-markdown-copy`.
 *
 * The whole feature runs in the browser (Client) half: it listens for the
 * native `copy` event inside the chat flow and replaces the clipboard payload
 * with reconstructed Markdown source.  Nothing is needed on the Host side, but
 * a bundle must still export an `apply` entry point.
 */
export function apply() {}
