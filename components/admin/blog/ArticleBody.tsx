import { renderMarkdown } from "@/lib/blog/markdown";
import { cn } from "@/lib/utils";

/** The article as readers see it. Server and client safe: the renderer escapes everything it did not generate. */
export function ArticleBody({ md, className }: { md: string; className?: string }) {
  const { html } = renderMarkdown(md);
  return <div className={cn("blog-prose", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
