-- O Forza Engine salva o relatório de análise estrutural como artifact
-- 'structural_analysis', mas o constraint engine_artifacts_kind_check (criado
-- em 20260519210000) não incluía esse kind — inserts falhavam com 23514.
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
      'quality_gate_report',
      'structural_analysis'
    )
  );
