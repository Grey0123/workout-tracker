/**
 * Progress photos: the owner's alone to add and remove, seen by others only where
 * the owner ticked them, and the files follow the same rule.
 */
import { describe, expect, it } from "vitest";
import { openDb } from "./harness";

const { as, rows, newUser, connect } = await openDb();

const addPhoto = (who: string, owner: string, path = `${owner}/a.jpg`) =>
  as(who, () => rows("insert into public.progress_photos (user_id, date, pose, path) values ($1, '2026-11-08', 'front', $2) returning id", [owner, path]));
const addFile = (who: string, name: string) =>
  as(who, () => rows("insert into storage.objects (bucket_id, name) values ('progress-photos', $1) returning id", [name]));

describe("progress photos", () => {
  it("are added by the owner only, into their own folder", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    await connect(owner, coach, "coach", { share_progress_photos: true });
    await addPhoto(owner, owner);
    await expect(addPhoto(coach, owner)).rejects.toThrow(/row-level security/);
    await expect(addPhoto(owner, owner, `${coach}/b.jpg`)).rejects.toThrow(/violates check constraint/);
    await addFile(owner, `${owner}/a.jpg`);
    await expect(addFile(coach, `${owner}/c.jpg`)).rejects.toThrow(/row-level security/);
  });

  it("are hidden until the owner ticks them for that person", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const coach = await newUser("coach");
    const friendship = await connect(owner, friend, "friend");
    await connect(owner, coach, "coach");
    await addPhoto(owner, owner);
    await addFile(owner, `${owner}/a.jpg`);

    for (const viewer of [friend, coach]) {
      await as(viewer, async () => {
        expect(await rows("select id from public.progress_photos where user_id = $1", [owner])).toEqual([]);
        expect(await rows("select id from storage.objects where bucket_id = 'progress-photos'")).toEqual([]);
      });
    }

    await rows("update public.connections set share_progress_photos = true where id = $1", [friendship]);
    await as(friend, async () => {
      expect((await rows("select id from public.progress_photos where user_id = $1", [owner])).length).toBe(1);
      expect((await rows("select id from storage.objects where bucket_id = 'progress-photos'")).length).toBe(1);
    });
    await as(coach, async () => expect(await rows("select id from public.progress_photos where user_id = $1", [owner])).toEqual([]));
  });

  it("are removed and relabelled by the owner only", async () => {
    const owner = await newUser();
    const friend = await newUser();
    await connect(owner, friend, "friend", { share_progress_photos: true });
    const [photo] = await addPhoto(owner, owner);
    await as(friend, async () => {
      await rows("update public.progress_photos set pose = 'side' where id = $1", [photo.id]);
      await rows("delete from public.progress_photos where id = $1", [photo.id]);
    });
    await as(owner, async () => expect(await rows("select pose from public.progress_photos where id = $1", [photo.id])).toEqual([{ pose: "front" }]));
    await expect(as(owner, () => rows("update public.progress_photos set path = $2 where id = $1", [photo.id, `${owner}/z.jpg`]))).rejects.toThrow(/permission denied/);
    await as(owner, () => rows("update public.progress_photos set pose = 'back' where id = $1", [photo.id]));
    await as(owner, () => rows("delete from public.progress_photos where id = $1", [photo.id]));
    expect(await rows("select id from public.progress_photos where id = $1", [photo.id])).toEqual([]);
  });
});
