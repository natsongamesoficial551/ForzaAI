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

        const html = files?.find((f) => f.path === "index.html")?.content ?? "";
        const css = files?.find((f) => f.path === "styles.css")?.content ?? "";
        const js = files?.find((f) => f.path === "script.js")?.content ?? "";

        const hasHtmlDocument = /<!doctype html>/i.test(html) || /<html[\s>]/i.test(html);
        let doc: string;
        if (hasHtmlDocument) {
          doc = html;
          if (css && !/<style/i.test(doc)) {
            doc = doc.replace(/<\/head>/i, `<style>${css}</style></head>`);
          }
          if (js && !/<script/i.test(doc)) {
            doc = doc.replace(/<\/body>/i, `<script>${js}<\/script></body>`);
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
