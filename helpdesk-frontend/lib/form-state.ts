/** What a form action hands back to its form: an error, a success note, and the text to keep in the inputs. */
export interface FormState {
  error?: string;
  ok?: string;
  fields?: Record<string, string>;
}
