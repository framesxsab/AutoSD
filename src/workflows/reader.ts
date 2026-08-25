/**
 * Reader workflow — loads content and emits accessible reading order.
 */

export type ReaderDocument = {
  id: string;
  title: string;
  content: string;
};

export type ReaderPage = {
  docId: string;
  index: number;
  text: string;
  ariaLabel: string;
};

export class ReaderWorkflow {
  paginate(doc: ReaderDocument, charsPerPage = 1000): ReaderPage[] {
    const pages: ReaderPage[] = [];
    for (let i = 0; i < doc.content.length; i += charsPerPage) {
      const text = doc.content.slice(i, i + charsPerPage);
      pages.push({
        docId: doc.id,
        index: pages.length,
        text,
        ariaLabel: `${doc.title} — page ${pages.length + 1}`,
      });
    }
    return pages;
  }

  toLiveRegion(page: ReaderPage): string {
    return `${page.ariaLabel}: ${page.text.slice(0, 120)}…`;
  }
}
