"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <p className="text-sm text-rose-700">Something went wrong: {error.message}</p>
      <button type="button" onClick={reset} className="mt-2 rounded-md bg-slate-900 px-3 py-1 text-sm text-white">Try again</button>
    </div>
  );
}
