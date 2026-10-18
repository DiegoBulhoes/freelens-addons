/** Runs a click that opens a drawer: unprevented, the drawer it mounts hears the same click on window as outside and closes. */
export function keepDrawerOpen(event: { preventDefault(): void }, act: () => void): void {
  event.preventDefault();
  act();
}
