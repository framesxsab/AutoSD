import { ReaderView } from "../../ui/ReaderView.js";
import type { ViewContext } from "../router.js";

export function createReaderView(ctx: ViewContext) {
  const readerView = new ReaderView({
    onCitationOpen: cit => ctx.announce(`Opened citation ${cit.chunkId}`),
  });
  let rendered = false;
  const root = readerView.getElement();

  return {
    root,
    mount(host: HTMLElement) {
      host.appendChild(root);
      if (!rendered) {
        readerView.render({
          id: "welcome",
          title: "Welcome to AutoSD",
          content: "Select a document from the corpus to begin reading with grounded citations.",
        });
        rendered = true;
      }
    },
    unmount() {
      root.remove();
    },
  };
}
