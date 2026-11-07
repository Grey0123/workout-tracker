"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useLog } from "@/components/log/log-provider";
import { dayMonth } from "@/lib/log/dates";
import type { Entry, Exercise } from "@/lib/log/types";
import * as progress from "@/lib/progress/api";
import { inRange, type Filter, type Range } from "@/lib/progress/calc";

const clock = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

/** A clip that loads only when asked, since videos are the heaviest thing in the app. */
export function VideoTile({ video, title, onDelete }: { video: progress.Video; title: string; onDelete?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function play() {
    setBusy(true);
    try {
      setUrl(await progress.videoLink(video.path));
    } catch (err) {
      console.error(err);
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <div className="video-tile">
      {url ? (
        <video src={url} controls autoPlay playsInline className="video-player" aria-label={title} />
      ) : (
        <button type="button" className="video-thumb" onClick={play} disabled={busy} aria-label={`Play ${title}`}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="#fff">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
      <div className="video-meta">
        <span>{title}</span>
        <small>{failed ? "Couldn't load this video." : `${clock(video.duration_s)}${busy ? " · loading…" : ""}`}</small>
        {onDelete && (
          <button type="button" className="link-btn danger-link" onClick={onDelete}>
            Delete video
          </button>
        )}
      </div>
    </div>
  );
}

/** Videos of one exercise on one day, with Add for the owner (PRD 5.1: workout videos). */
export function EntryVideos({ entry, name, canAdd }: { entry: Entry; name: string; canAdd: boolean }) {
  const { videos, isOwn, profile, update, toast, shares } = useLog();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!shares.workouts) return null;
  const mine = videos.filter((v) => v.exercise_id === entry.exercise_id && (!entry.session_id || v.session_id === entry.session_id));

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const video = await progress.uploadVideo(profile.id, entry.id, entry.exercise_id, file);
      update((d) => ({ ...d, videos: [video, ...d.videos] }));
      toast("Video added");
    } catch (err) {
      console.error(err);
      toast(err instanceof Error && !err.message.includes("JWT") ? err.message : "Couldn't add that video.", "err");
    }
    setBusy(false);
  }

  async function remove(video: progress.Video) {
    if (!confirm("Delete this video?")) return;
    update((d) => ({ ...d, videos: d.videos.filter((v) => v.id !== video.id) }));
    try {
      await progress.deleteVideo(video);
      toast("Video deleted");
    } catch (err) {
      console.error(err);
      update((d) => ({ ...d, videos: [video, ...d.videos] }));
      toast("Couldn't delete that video.", "err");
    }
  }

  const adding = isOwn && canAdd;
  if (!mine.length && !adding) return null;
  return (
    <div className="entry-videos">
      {mine.map((v, i) => (
        <VideoTile key={v.id} video={v} title={`${name} video${mine.length > 1 ? ` ${i + 1}` : ""}`} onDelete={isOwn ? () => remove(v) : undefined} />
      ))}
      {adding && !entry.saving && (
        <>
          <input ref={input} type="file" accept="video/mp4,video/webm,video/quicktime" hidden onChange={add} aria-label={`Video for ${name}`} />
          <button type="button" className="btn ghost sm add-video" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : "Add video"}
          </button>
          <span className="cx-hint">Up to a minute and 50 MB. Seen by people you share workouts with.</span>
        </>
      )}
    </div>
  );
}

/** Clips from the period, grouped by exercise, to compare form over time (PRD 5.4). */
export function VideosSection({ range, filter, byId }: { range: Range; filter: Filter; byId: Map<string, Exercise> }) {
  const { videos, entries, isOwn } = useLog();
  if (!videos.length && !isOwn) return null;
  const sessionDay = new Map(entries.filter((e) => e.session_id).map((e) => [e.session_id!, e.date]));
  const dayOf = (v: progress.Video) => sessionDay.get(v.session_id) ?? v.created_at.slice(0, 10);
  const matches = (v: progress.Video) =>
    filter.kind === "all" ||
    (filter.kind === "exercise" && v.exercise_id === filter.id) ||
    (filter.kind === "muscle" && !!v.exercise_id && byId.get(v.exercise_id)?.category === filter.category);
  const shown = videos.filter((v) => inRange(dayOf(v), range) && matches(v));
  const groups = new Map<string, progress.Video[]>();
  for (const v of shown) groups.set(v.exercise_id ?? "", [...(groups.get(v.exercise_id ?? "") ?? []), v]);

  return (
    <>
      <h2 className="section">Form videos</h2>
      {shown.length ? (
        <div className="video-groups">
          {[...groups].map(([exerciseId, list]) => (
            <section className="card video-group" key={exerciseId}>
              <div className="field-label">{byId.get(exerciseId)?.name ?? "Workout"}</div>
              {list.map((v) => (
                <VideoTile key={v.id} video={v} title={`${byId.get(exerciseId)?.name ?? "Workout"}, ${dayMonth(dayOf(v))}`} />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="card no-entries">
          {videos.length ? "No videos in this period." : "No videos yet. Add one to an exercise in the calendar to check your form over time."}
        </div>
      )}
    </>
  );
}
