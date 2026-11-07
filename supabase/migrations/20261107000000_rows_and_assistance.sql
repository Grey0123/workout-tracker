-- Library changes from the review of the draft (2026-11-07).

-- On an assisted exercise the weight is the help the machine gives, so less is
-- better, and it isn't weight lifted.
alter table public.exercises add column assisted boolean not null default false;
alter table public.exercises add constraint exercises_assisted_has_weight
  check (not assisted or 'weight_kg' = any (inputs));

update public.exercises set assisted = true
where not is_custom and name in ('Assisted Pull Up', 'Assisted Dip');

-- Seated Row, Seated Row Machine and Low Row are one exercise. Which machine it
-- was goes in the variant, so nothing logged is lost and the history stays in one chart.
update public.session_exercises se
set exercise_id = target.id,
    variant = left(concat_ws(' · ', merged.machine, nullif(se.variant, '')), 100)
from (values ('Seated Row Machine', 'Machine'), ('Low Row', 'Low row machine')) as merged (name, machine)
join public.exercises old on old.name = merged.name and not old.is_custom
cross join (select id from public.exercises where name = 'Seated Row' and not is_custom) as target
where se.exercise_id = old.id;

delete from public.exercises where not is_custom and name in ('Seated Row Machine', 'Low Row');
