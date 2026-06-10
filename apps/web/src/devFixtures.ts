import type { Job } from "@scribd-dl/shared";
import { $jobs } from "@/store";

const FAKE_JOBS: ReadonlyArray<Job> = [
  {
    id: "fake-queued-short",
    url: "https://www.scribd.com/document/111111111/queued-short",
    domain: "scribd",
    displayTitle: "Queued: Short Title",
    status: "Queued",
  },
  {
    id: "fake-queued-long",
    url: "https://www.scribd.com/document/222222222/queued-long",
    domain: "scribd",
    displayTitle:
      "Queued: A Very Very Very Long Title That Should Test Truncation, Wrapping, And Other Layout Edge Cases In The UI Row",
    status: "Queued",
  },
  {
    id: "fake-downloading-scrape",
    url: "https://www.scribd.com/document/333333333/downloading-scrape",
    domain: "scribd",
    displayTitle: "Downloading (scrape stage)",
    status: "Downloading",
    progress: { done: 3, total: 12, stage: "scrape" },
  },
  {
    id: "fake-downloading-render",
    url: "https://www.scribd.com/document/444444444/downloading-render",
    domain: "scribd",
    displayTitle: "Downloading (render stage, almost done)",
    status: "Downloading",
    progress: { done: 47, total: 50, stage: "render" },
  },
  {
    id: "fake-downloaded",
    url: "https://www.scribd.com/document/555555555/downloaded",
    domain: "scribd",
    displayTitle: "Downloaded: Finished Successfully",
    status: "Downloaded",
  },
  {
    id: "fake-failed-retryable",
    url: "https://www.scribd.com/document/666666666/failed-retryable",
    domain: "scribd",
    displayTitle: "Failed: Network error (retryable)",
    status: "Failed",
    failure: { reason: "Network timeout while fetching page 7", retryable: true },
  },
  {
    id: "fake-failed-nonretryable",
    url: "https://www.scribd.com/document/777777777/failed-nonretryable",
    domain: "scribd",
    displayTitle: "Failed: Document not found (non-retryable)",
    status: "Failed",
    failure: { reason: "Document is private or has been removed", retryable: false },
  },
  {
    id: "fake-failed-unsupported",
    url: "https://example.com/some/random/page",
    domain: "unsupported",
    displayTitle: "https://example.com/some/random/page",
    status: "Failed",
    failure: { reason: "Unsupported domain: example.com", retryable: false },
  },
  {
    id: "fake-failed-long-reason",
    url: "https://www.scribd.com/document/888888888/failed-long-reason",
    domain: "scribd",
    displayTitle: "Failed: Very long failure reason to test multi-line error messages",
    status: "Failed",
    failure: {
      reason:
        "Puppeteer crashed: Protocol error (Target.createTarget): Target closed. This often happens when the page navigates away during scraping or when memory runs out. Try again with fewer concurrent jobs.",
      retryable: true,
    },
  },
];

export const installFakeJobs = (): void => {
  const unsubscribe = $jobs.listen(() => {
    unsubscribe();
    for (const job of FAKE_JOBS) $jobs.setKey(job.id, job);
  });
};
