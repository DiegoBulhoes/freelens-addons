/** Runs a click that unmounts its own control: the host's Drawer would read it as a click outside and close. */
export function keepDrawerOpen(event: { preventDefault(): void }, act: () => void): void {
  event.preventDefault();
  act();
}
