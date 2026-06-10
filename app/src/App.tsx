import { Header } from "@/components/Header";
import { Queue } from "@/components/Queue";
import { StatusBar } from "@/components/StatusBar";
import { useEngineState } from "@/hooks/useEngineState";
import { fetchFolder } from "@/lib/api";
import { useEffect, useState } from "react";

export const App = () => {
  const { snapshot, baseUrl } = useEngineState();
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => {
    if (!baseUrl) return;
    fetchFolder(baseUrl)
      .then(setFolder)
      .catch(() => setFolder(null));
  }, [baseUrl, snapshot]);

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <Header folder={folder} />
      <Queue snapshot={snapshot} />
      <StatusBar />
    </div>
  );
};
