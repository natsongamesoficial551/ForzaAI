import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/projects/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
