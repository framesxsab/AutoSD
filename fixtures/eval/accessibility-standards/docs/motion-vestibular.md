# Reduced Motion and Vestibular Safety

Parallax scrolling, zooming transitions, auto-playing carousels, and pulsing animations can trigger dizziness, migraines, nausea, and seizures in visitors with vestibular disorders or photosensitive conditions. Modern stylesheets and scripts should query the prefers-reduced-motion media feature and disable non-essential movement automatically whenever the operating system requests reduced animation.

When motion conveys genuine state change, replacing sliding or bouncing effects with subtle opacity crossfades or instant state switches preserves clarity without triggering physical discomfort. Any moving, blinking, or auto-updating ticker lasting longer than five seconds requires an accessible pause, stop, or hide button reachable by keyboard. Flashing lights or sudden contrast reversals must never exceed three flashes within any one-second interval to prevent photosensitive seizure hazards across web applications and embedded kiosk interfaces.
