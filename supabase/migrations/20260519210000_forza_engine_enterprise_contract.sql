alter table public.engine_runs
  add column if not exists project_kind text,
  add column if not exists complexity text,
  add column if not exists quality_score integer;

alter table public.engine_artifacts
  drop constraint if exists engine_artifacts_kind_check;

alter table public.engine_artifacts
  add constraint engine_artifacts_kind_check check (
    kind in (
      'brief',
      'product_plan',
      'technical_plan',
      'task_plan',
      'validation_report',
      'model_raw_output',
      'intent_classification',
      'requirements_matrix',
      'ux_blueprint',
      'saas_blueprint',
      'backend_blueprint',
      'database_blueprint',
      'integration_manifest',
      'design_system',
      'implementation_manifest',
      'quality_gate_report'
    )
  );

alter table public.engine_runs
  drop constraint if exists engine_runs_project_kind_check;

alter table public.engine_runs
  add constraint engine_runs_project_kind_check check (
    project_kind is null or project_kind in (
      'landing_page',
      'portfolio',
      'ecommerce',
      'saas',
      'dashboard',
      'internal_tool',
      'other'
    )
  );

alter table public.engine_runs
  drop constraint if exists engine_runs_complexity_check;

alter table public.engine_runs
  add constraint engine_runs_complexity_check check (
    complexity is null or complexity in ('simple', 'standard', 'advanced', 'enterprise')
  );

alter table public.engine_runs
  drop constraint if exists engine_runs_quality_score_check;

alter table public.engine_runs
  add constraint engine_runs_quality_score_check check (
    quality_score is null or (quality_score >= 0 and quality_score <= 100)
  );

create index if not exists engine_runs_project_kind_idx on public.engine_runs(project_kind);
create index if not exists engine_runs_complexity_idx on public.engine_runs(complexity);
