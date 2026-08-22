import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export const Route = createFileRoute("/s/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("id, name, status, slug")
          .eq("slug", params.slug)
          .eq("status", "published")
          .maybeSingle();

        if (!project) {
          return new Response("Site não encontrado", { status: 404 });
        }

        const { data: files } = await supabaseAdmin
          .from("project_files")
          .select("path, content")
          .eq("project_id", project.id);

        const rawHtml = files?.find((f) => f.path === "index.html")?.content ?? "";
        const css = files?.find((f) => f.path === "styles.css")?.content ?? "";
        const js = files?.find((f) => f.path === "script.js")?.content ?? "";

        // Alguns modelos salvam o HTML escapado (&lt;!DOCTYPE...) — des-escapa
        // para o site publicado renderizar a página, não o código como texto.
        const looksEscaped = /&lt;(!doctype|html|head|body|main|section|div|style|script)\b/i.test(rawHtml);
        const hasRawTags = /<(?:!doctype|html|head|body)\b/i.test(rawHtml);
        const html =
          looksEscaped && !hasRawTags
            ? rawHtml
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&#x27;/g, "'")
                .replace(/&amp;/g, "&")
                .trim()
            : rawHtml;

        // React/JSX: shell referencia text/babel ou o script contém JSX —
        // precisa do Babel standalone (com CDNs se o shell não trouxer).
        const isBabel =
          /type=["']text\/babel/i.test(html) ||
          /ReactDOM\.createRoot|<([A-Z][A-Za-z0-9]*)[\s/>]|React\.(?:createElement|Fragment)|const\s*\{[^}]*\}\s*=\s*React/.test(
            js,
          );

        const hasHtmlDocument = /<!doctype html>/i.test(html) || /<html[\s>]/i.test(html);
        let doc: string;
        if (hasHtmlDocument) {
          doc = html;
          // Mobile: sem viewport meta o navegador renderiza como desktop
          // (~980px virtual) em qualquer celular — garante a tag.
          if (!/<meta[^>]+name=["']viewport["']/i.test(doc)) {
            doc = doc.replace(
              /<head[^>]*>/i,
              (m) => `${m}<meta name="viewport" content="width=device-width, initial-scale=1">`,
            );
          }
          // O doc referencia styles.css/script.js como arquivos que não existem
          // nesta rota (404): remove as referências e injeta o conteúdo inline.
          if (css) {
            doc = doc.replace(/<link\b[^>]*href=["'][^"']*styles\.css[^"']*["'][^>]*>/gi, "");
            doc = doc.replace(/<\/head>/i, `<style>${css}</style></head>`);
          }
          if (js) {
            doc = doc.replace(
              /<script\b[^>]*src=["'][^"']*script\.js[^"']*["'][^>]*>\s*<\/script>/gi,
              "",
            );
            if (isBabel && !/babel(?:-standalone)?\.min\.js/i.test(doc)) {
              const cdns =
                `<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>` +
                `<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>` +
                `<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>`;
              doc = doc.replace(/<\/body>/i, `${cdns}</body>`);
            }
            const scriptTag = isBabel
              ? `<script type="text/babel" data-presets="react,typescript">${js}<\/script>`
              : `<script>${js}<\/script>`;
            doc = doc.replace(/<\/body>/i, `${scriptTag}</body>`);
          }
        } else {
          doc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(project.name)}</title><style>${css}</style></head><body>${html}<script>${js}<\/script></body></html>`;
        }

        return new Response(doc, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=60",
          },
        });
      },
    },
  },
});
