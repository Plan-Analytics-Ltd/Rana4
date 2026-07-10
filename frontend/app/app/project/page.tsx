import { redirect } from "next/navigation";

/** Project overview was merged into the planning workspace — keep route for bookmarks. */
export default function ProjectOverviewRedirectPage() {
  redirect("/app/schedule");
}
