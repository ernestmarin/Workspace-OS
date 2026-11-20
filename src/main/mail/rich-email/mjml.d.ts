declare module 'mjml' {
  export interface MjmlCompileError {
    line?: number
    message?: string
    tagName?: string
    formattedMessage?: string
  }

  export interface MjmlCompileOptions {
    validationLevel?: 'strict' | 'soft' | 'skip'
    filePath?: string
  }

  export interface MjmlCompileOutput {
    html: string
    json?: unknown
    errors?: MjmlCompileError[]
  }

  export default function mjml2html(
    source: string,
    options?: MjmlCompileOptions,
  ): Promise<MjmlCompileOutput>
}
