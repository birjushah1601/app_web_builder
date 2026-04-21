"use client";

interface Props {
  gate: string;
  onAskReviewer: () => void;
}

export function EscalationCallout({ gate, onAskReviewer }: Props) {
  return (
    <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>You&apos;re not authorised to risk-accept the <strong>{gate}</strong> gate. Ask a reviewer (Priya tier) to take a look.</p>
      <button type="button" onClick={onAskReviewer} className="mt-2 rounded-md bg-amber-600 px-3 py-1 text-white">Ask a reviewer</button>
    </div>
  );
}
