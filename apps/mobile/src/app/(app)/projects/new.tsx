import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { ProjectForm } from "../../../projects/ProjectForm";
import { useProjects } from "../../../projects/ProjectsProvider";

export default function NewProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { create, setCurrentProject } = useProjects();

  return (
    <ProjectForm
      initial={{ name: "", description: "", currency: "VND" }}
      submitLabel={t("projects.createButton")}
      onSubmit={async (fields) => {
        const result = await create(fields);
        if (result.ok) {
          await setCurrentProject(result.id);
          router.replace("/");
        }
        return result;
      }}
    />
  );
}
