// A hung Supabase call (dead network, unreachable project, or the odd
// silent stall some auth calls have shown in this app — see AuthContext.tsx
// history) must not leave a screen stuck on a loading spinner forever with
// no error and no way out short of a hard refresh. Wrap any such call in
// this before awaiting it.
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
