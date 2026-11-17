export function dismissCheckoutWarning(event: Event): void {
  const target = event.target as Element | null;
  const button = target?.closest?.("button[data-dismiss-checkout-warning]");
  const warning = button?.closest(".checkout-fault.waiting");
  if (!warning) return;
  event.preventDefault();
  warning.remove();
}
