/** Shows a drawer once the click that led here is over; the host's Drawer closes on a click outside it. */
export function showDetailsAfterClick(link: string, show: (link: string) => void): () => void {
  const timer = setTimeout(() => show(link), 0);

  return () => clearTimeout(timer);
}
