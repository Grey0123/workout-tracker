"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLog } from "@/components/log/log-provider";
import { dayMonth, dayMonthYear, todayKey } from "@/lib/log/dates";
import { resizePhoto } from "@/lib/log/api";
import { fmtKg, plural } from "@/lib/log/sets";
import * as progress from "@/lib/progress/api";
import type { Range } from "@/lib/progress/calc";
import { apart, defaultPair, posesOf, weightNear } from "@/lib/progress/photos";

/** A private photo, shown through a short-lived link once it's on screen. */
function PhotoImg({ photo, alt, className }: { photo: progress.ProgressPhoto; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    progress.progressPhotoLink(photo.path).then(
      (link) => live && setUrl(link),
      (err) => {
        console.error(err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [photo.path]);
  if (failed) return <div className={`pp-missing ${className ?? ""}`}>Couldn&apos;t load</div>;
  // eslint-disable-next-line @next/next/no-img-element -- signed, expiring links; next/image would cache them
  return url ? <img src={url} alt={alt} className={className} loading="lazy" /> : <div className={`pp-missing ${className ?? ""}`} aria-label={alt} />;
}

const poseLabel = (pose: string) => progress.POSES.find((p) => p.value === pose)?.label ?? pose;

/** Body: progress photos side by side, and adding one (PRD 5.4). */
export function ProgressPhotos({ range }: { range: Range }) {
  const { progressPhotos: photos, weights, isOwn, connection, profile, update, toast } = useLog();
  const input = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(todayKey());
  const [pose, setPose] = useState<progress.Pose>("front");
  const [busy, setBusy] = useState(false);
  const poses = posesOf(photos);
  const [shownPose, setShownPose] = useState<string | null>(null);
  const activePose = shownPose && poses.includes(shownPose) ? shownPose : poses[0];
  const [picked, setPicked] = useState<{ before?: string; after?: string }>({});

  const shared = isOwn || !!connection?.share_progress_photos;
  if (!shared) return null;

  const posed = photos.filter((p) => p.pose === activePose);
  const fallback = activePose ? defaultPair(photos, activePose, range.start, range.end) : null;
  const before = posed.find((p) => p.id === picked.before) ?? fallback?.[0];
  const after = posed.find((p) => p.id === picked.after) ?? fallback?.[1];
  const inPeriod = photos.filter((p) => p.date >= range.start && p.date <= range.end).reverse();

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const photo = await progress.addProgressPhoto(profile.id, await resizePhoto(file), date, pose, null);
      update((d) => ({ ...d, progressPhotos: [...d.progressPhotos, photo].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)) }));
      setShownPose(pose);
      setPicked({});
      toast(`${poseLabel(pose)} photo added for ${dayMonth(date)}`);
    } catch (err) {
      console.error(err);
      toast(err instanceof Error && err.message.includes("image") ? err.message : "Couldn't add that photo. Check your connection.", "err");
    }
    setBusy(false);
  }

  async function remove(photo: progress.ProgressPhoto) {
    if (!confirm(`Delete the ${poseLabel(photo.pose).toLowerCase()} photo from ${dayMonth(photo.date)}?`)) return;
    update((d) => ({ ...d, progressPhotos: d.progressPhotos.filter((p) => p.id !== photo.id) }));
    try {
      await progress.deleteProgressPhoto(photo);
      toast("Photo deleted");
    } catch (err) {
      console.error(err);
      update((d) => ({ ...d, progressPhotos: [...d.progressPhotos, photo].sort((a, b) => a.date.localeCompare(b.date)) }));
      toast("Couldn't delete that photo.", "err");
    }
  }

  const caption = (p: progress.ProgressPhoto) => {
    const w = weightNear(weights, p.date);
    return `${dayMonthYear(p.date)}${w ? ` · ${fmtKg(w.kg)} kg` : ""}`;
  };

  return (
    <>
      <h2 className="section">Progress photos</h2>
      <section className="card progress-photos" aria-label="Progress photos">
        {poses.length > 1 && (
          <div className="period-chips pose-chips" role="group" aria-label="Pose">
            {poses.map((p) => (
              <button
                key={p}
                type="button"
                className={p === activePose ? "active" : ""}
                aria-pressed={p === activePose}
                onClick={() => {
                  setShownPose(p);
                  setPicked({});
                }}
              >
                {poseLabel(p)}
              </button>
            ))}
          </div>
        )}

        {before && after && before.id !== after.id ? (
          <>
            <div className="pp-compare">
              {[
                { photo: before, label: "Before", key: "before" as const },
                { photo: after, label: "After", key: "after" as const },
              ].map(({ photo, label, key }) => (
                <figure key={key}>
                  <PhotoImg photo={photo} alt={`${label}: ${poseLabel(photo.pose)}, ${dayMonth(photo.date)}`} className="pp-big" />
                  <figcaption>
                    <select
                      aria-label={`${label} photo`}
                      value={photo.id}
                      onChange={(e) => setPicked((x) => ({ ...x, [key]: e.target.value }))}
                    >
                      {posed.map((p) => (
                        <option key={p.id} value={p.id}>
                          {dayMonthYear(p.date)}
                        </option>
                      ))}
                    </select>
                    <span className="cx-hint">{caption(photo)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <div className="cx-hint pp-apart">{apart(before.date, after.date)}</div>
          </>
        ) : (
          <div className="cx-hint">
            {photos.length
              ? `Add another ${activePose ? poseLabel(activePose).toLowerCase() : ""} photo to see them side by side.`
              : isOwn
                ? "No photos yet. Take one in the same spot and light every few weeks to see changes the scale misses."
                : `${profile.display_name} hasn't added any photos yet.`}
          </div>
        )}

        {inPeriod.length > 0 && (
          <>
            <div className="field-label pp-strip-label">In this period · {plural(inPeriod.length, "photo")}</div>
            <ul className="pp-strip">
              {inPeriod.map((p) => (
                <li key={p.id}>
                  <PhotoImg photo={p} alt={`${poseLabel(p.pose)}, ${dayMonth(p.date)}`} className="pp-thumb" />
                  <span>
                    {dayMonth(p.date)} · {poseLabel(p.pose)}
                  </span>
                  {isOwn && (
                    <button type="button" className="pp-del" aria-label={`Delete ${poseLabel(p.pose).toLowerCase()} photo from ${dayMonth(p.date)}`} onClick={() => remove(p)}>
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {isOwn && (
          <div className="pp-add">
            <input type="date" aria-label="Photo date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
            <select aria-label="Pose" value={pose} onChange={(e) => setPose(e.target.value as progress.Pose)}>
              {progress.POSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <input ref={input} type="file" accept="image/*" hidden onChange={add} aria-label="Progress photo" />
            <button type="button" className="btn sm" disabled={busy || !date} onClick={() => input.current?.click()}>
              {busy ? "Uploading…" : "Add photo"}
            </button>
            <div className="cx-hint pp-who">
              {/* PRD 5.2: you always know who can see it. */}
              Only you see these unless you tick Progress photos for someone on People.
            </div>
          </div>
        )}
      </section>
    </>
  );
}
