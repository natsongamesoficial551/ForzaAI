-- Add publish fields to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

CREATE INDEX IF NOT EXISTS projects_slug_idx ON public.projects (slug) WHERE slug IS NOT NULL;

-- Storage bucket for AI-generated images
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-assets', 'project-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Public read of project-assets
CREATE POLICY "project-assets public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'project-assets');

-- Authenticated users can upload to their own project folder (folder = project id they own)
CREATE POLICY "project-assets owner write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'project-assets'
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = (storage.foldername(name))[1]
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY "project-assets owner update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'project-assets'
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = (storage.foldername(name))[1]
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY "project-assets owner delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'project-assets'
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id::text = (storage.foldername(name))[1]
      AND p.user_id = auth.uid()
  )
);