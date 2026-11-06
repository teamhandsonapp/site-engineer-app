// Native: the phone renderer (Step 1) will report the real page count.
export async function pageCount(_versionId: string, _url: string): Promise<number> {
  return 1;
}
