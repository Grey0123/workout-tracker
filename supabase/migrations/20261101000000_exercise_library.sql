-- The built-in exercise library (PRD 5.1): 15 categories by target muscle.
--
-- This is a draft to review. The PRD's seed, exercises.json, couldn't be found, so
-- the list was rewritten from the PRD's categories and every name v1 has logged.
--
-- A kind decides what the log form asks for:
--   weighted    weight + reps
--   bodyweight  reps, optional added weight
--   timed       time, optional weight
--   cardio      time + distance
--   session     time only

insert into public.exercises (name, category, secondary_muscles, equipment, kind, inputs)
select name, category, string_to_array(others, ','), equipment, kind::public.exercise_kind,
       case kind
         when 'weighted'   then array['weight_kg', 'reps', 'tempo']
         when 'bodyweight' then array['weight_kg', 'reps', 'tempo']
         when 'timed'      then array['weight_kg', 'duration_s']
         when 'cardio'     then array['duration_s', 'distance_km']
         when 'session'    then array['duration_s']
       end
from (values
  -- Chest
  ('Bench Press', 'Chest', 'Triceps,Shoulders', 'Barbell', 'weighted'),
  ('Incline Bench Press', 'Chest', 'Shoulders,Triceps', 'Barbell', 'weighted'),
  ('Decline Bench Press', 'Chest', 'Triceps', 'Barbell', 'weighted'),
  ('Close-Grip Bench Press', 'Chest', 'Triceps,Shoulders', 'Barbell', 'weighted'),
  ('Dumbbell Bench Press', 'Chest', 'Triceps,Shoulders', 'Dumbbell', 'weighted'),
  ('Incline Dumbbell Press', 'Chest', 'Shoulders,Triceps', 'Dumbbell', 'weighted'),
  ('Decline Dumbbell Press', 'Chest', 'Triceps', 'Dumbbell', 'weighted'),
  ('Chest Press', 'Chest', 'Triceps,Shoulders', 'Machine', 'weighted'),
  ('Incline Chest Press', 'Chest', 'Shoulders,Triceps', 'Machine', 'weighted'),
  ('Smith Machine Bench Press', 'Chest', 'Triceps,Shoulders', 'Smith machine', 'weighted'),
  ('Pec Deck Fly', 'Chest', '', 'Machine', 'weighted'),
  ('Dumbbell Fly', 'Chest', '', 'Dumbbell', 'weighted'),
  ('Incline Dumbbell Fly', 'Chest', 'Shoulders', 'Dumbbell', 'weighted'),
  ('Cable Fly', 'Chest', '', 'Cable', 'weighted'),
  ('Low-to-High Cable Fly', 'Chest', 'Shoulders', 'Cable', 'weighted'),
  ('Push Up', 'Chest', 'Triceps,Shoulders,Core & abs', 'None', 'bodyweight'),
  ('Incline Push Up', 'Chest', 'Triceps,Shoulders', 'None', 'bodyweight'),
  ('Chest Dip', 'Chest', 'Triceps,Shoulders', 'None', 'bodyweight'),

  -- Back
  ('Deadlift', 'Back', 'Hamstrings,Glutes & hips,Forearms & grip', 'Barbell', 'weighted'),
  ('Barbell Row', 'Back', 'Biceps,Forearms & grip', 'Barbell', 'weighted'),
  ('Pendlay Row', 'Back', 'Biceps', 'Barbell', 'weighted'),
  ('T-Bar Row', 'Back', 'Biceps', 'Barbell', 'weighted'),
  ('Dumbbell Row', 'Back', 'Biceps,Forearms & grip', 'Dumbbell', 'weighted'),
  ('Chest-Supported Row', 'Back', 'Biceps', 'Dumbbell', 'weighted'),
  ('Seated Row', 'Back', 'Biceps', 'Cable', 'weighted'),
  ('Seated Row Machine', 'Back', 'Biceps', 'Machine', 'weighted'),
  ('Low Row', 'Back', 'Biceps', 'Machine', 'weighted'),
  ('High Row', 'Back', 'Biceps,Shoulders', 'Machine', 'weighted'),
  ('Lat Pulldown', 'Back', 'Biceps', 'Cable', 'weighted'),
  ('Close-Grip Lat Pulldown', 'Back', 'Biceps', 'Cable', 'weighted'),
  ('Straight-Arm Pulldown', 'Back', '', 'Cable', 'weighted'),
  ('Pull Up', 'Back', 'Biceps,Forearms & grip', 'Pull-up bar', 'bodyweight'),
  ('Chin Up', 'Back', 'Biceps', 'Pull-up bar', 'bodyweight'),
  ('Assisted Pull Up', 'Back', 'Biceps', 'Machine', 'weighted'),
  ('Inverted Row', 'Back', 'Biceps,Core & abs', 'None', 'bodyweight'),
  ('Rack Pull', 'Back', 'Glutes & hips,Forearms & grip', 'Barbell', 'weighted'),
  ('Back Extension', 'Back', 'Glutes & hips,Hamstrings', 'Machine', 'bodyweight'),
  ('Good Morning', 'Back', 'Hamstrings,Glutes & hips', 'Barbell', 'weighted'),
  ('Barbell Shrug', 'Back', 'Forearms & grip', 'Barbell', 'weighted'),
  ('Dumbbell Shrug', 'Back', 'Forearms & grip', 'Dumbbell', 'weighted'),
  ('Superman Hold', 'Back', 'Glutes & hips', 'None', 'timed'),
  ('Dead Hang', 'Back', 'Forearms & grip', 'Pull-up bar', 'timed'),

  -- Shoulders
  ('Overhead Press', 'Shoulders', 'Triceps', 'Barbell', 'weighted'),
  ('Shoulder Press', 'Shoulders', 'Triceps', 'Machine', 'weighted'),
  ('Dumbbell Shoulder Press', 'Shoulders', 'Triceps', 'Dumbbell', 'weighted'),
  ('Arnold Press', 'Shoulders', 'Triceps', 'Dumbbell', 'weighted'),
  ('Push Press', 'Shoulders', 'Triceps,Quads', 'Barbell', 'weighted'),
  ('Lateral Raise', 'Shoulders', '', 'Dumbbell', 'weighted'),
  ('Cable Lateral Raise', 'Shoulders', '', 'Cable', 'weighted'),
  ('Machine Lateral Raise', 'Shoulders', '', 'Machine', 'weighted'),
  ('Front Raise', 'Shoulders', '', 'Dumbbell', 'weighted'),
  ('Reverse Pec Deck Fly', 'Shoulders', 'Back', 'Machine', 'weighted'),
  ('Bent-Over Reverse Fly', 'Shoulders', 'Back', 'Dumbbell', 'weighted'),
  ('Face Pull', 'Shoulders', 'Back', 'Cable', 'weighted'),
  ('Upright Row', 'Shoulders', 'Back', 'Barbell', 'weighted'),
  ('Pike Push Up', 'Shoulders', 'Triceps', 'None', 'bodyweight'),
  ('Handstand Push Up', 'Shoulders', 'Triceps,Core & abs', 'None', 'bodyweight'),
  ('Band Pull-Apart', 'Shoulders', 'Back', 'Resistance band', 'weighted'),

  -- Biceps
  ('Bicep Curl', 'Biceps', 'Forearms & grip', 'Dumbbell', 'weighted'),
  ('Barbell Curl', 'Biceps', 'Forearms & grip', 'Barbell', 'weighted'),
  ('EZ-Bar Curl', 'Biceps', 'Forearms & grip', 'EZ bar', 'weighted'),
  ('Hammer Curl', 'Biceps', 'Forearms & grip', 'Dumbbell', 'weighted'),
  ('Incline Dumbbell Curl', 'Biceps', '', 'Dumbbell', 'weighted'),
  ('Concentration Curl', 'Biceps', '', 'Dumbbell', 'weighted'),
  ('Preacher Curl', 'Biceps', '', 'EZ bar', 'weighted'),
  ('Machine Preacher Curl', 'Biceps', '', 'Machine', 'weighted'),
  ('Cable Curl', 'Biceps', 'Forearms & grip', 'Cable', 'weighted'),
  ('Spider Curl', 'Biceps', '', 'Dumbbell', 'weighted'),
  ('Zottman Curl', 'Biceps', 'Forearms & grip', 'Dumbbell', 'weighted'),

  -- Triceps
  ('Tricep Pushdown', 'Triceps', '', 'Cable', 'weighted'),
  ('Rope Pushdown', 'Triceps', '', 'Cable', 'weighted'),
  ('Overhead Tricep Extension', 'Triceps', '', 'Dumbbell', 'weighted'),
  ('Cable Overhead Extension', 'Triceps', '', 'Cable', 'weighted'),
  ('Skull Crusher', 'Triceps', '', 'EZ bar', 'weighted'),
  ('Dumbbell Kickback', 'Triceps', '', 'Dumbbell', 'weighted'),
  ('Machine Tricep Extension', 'Triceps', '', 'Machine', 'weighted'),
  ('Tricep Dip', 'Triceps', 'Chest,Shoulders', 'None', 'bodyweight'),
  ('Assisted Dip', 'Triceps', 'Chest,Shoulders', 'Machine', 'weighted'),
  ('Bench Dip', 'Triceps', 'Shoulders', 'None', 'bodyweight'),
  ('Diamond Push Up', 'Triceps', 'Chest', 'None', 'bodyweight'),

  -- Forearms & grip
  ('Wrist Curl', 'Forearms & grip', '', 'Dumbbell', 'weighted'),
  ('Reverse Wrist Curl', 'Forearms & grip', '', 'Dumbbell', 'weighted'),
  ('Reverse Curl', 'Forearms & grip', 'Biceps', 'EZ bar', 'weighted'),
  ('Farmer''s Carry', 'Forearms & grip', 'Back,Core & abs', 'Dumbbell', 'timed'),
  ('Plate Pinch', 'Forearms & grip', '', 'Other', 'timed'),
  ('Towel Hang', 'Forearms & grip', 'Back', 'Pull-up bar', 'timed'),
  ('Wrist Roller', 'Forearms & grip', '', 'Other', 'weighted'),

  -- Quads
  ('Squat', 'Quads', 'Glutes & hips,Hamstrings', 'Barbell', 'weighted'),
  ('Front Squat', 'Quads', 'Glutes & hips,Core & abs', 'Barbell', 'weighted'),
  ('Goblet Squat', 'Quads', 'Glutes & hips', 'Dumbbell', 'weighted'),
  ('Smith Machine Squat', 'Quads', 'Glutes & hips', 'Smith machine', 'weighted'),
  ('Hack Squat', 'Quads', 'Glutes & hips', 'Machine', 'weighted'),
  ('Pendulum Squat', 'Quads', 'Glutes & hips', 'Machine', 'weighted'),
  ('Leg Press', 'Quads', 'Glutes & hips', 'Machine', 'weighted'),
  ('Leg Extension', 'Quads', '', 'Machine', 'weighted'),
  ('Lunge', 'Quads', 'Glutes & hips,Hamstrings', 'None', 'bodyweight'),
  ('Walking Lunge', 'Quads', 'Glutes & hips,Hamstrings', 'Dumbbell', 'bodyweight'),
  ('Reverse Lunge', 'Quads', 'Glutes & hips', 'Dumbbell', 'bodyweight'),
  ('Bulgarian Split Squat', 'Quads', 'Glutes & hips', 'Dumbbell', 'bodyweight'),
  ('Step Up', 'Quads', 'Glutes & hips', 'Dumbbell', 'bodyweight'),
  ('Bodyweight Squat', 'Quads', 'Glutes & hips', 'None', 'bodyweight'),
  ('Wall Sit', 'Quads', 'Glutes & hips', 'None', 'timed'),

  -- Hamstrings
  ('Romanian Deadlift', 'Hamstrings', 'Glutes & hips,Back', 'Barbell', 'weighted'),
  ('Dumbbell Romanian Deadlift', 'Hamstrings', 'Glutes & hips', 'Dumbbell', 'weighted'),
  ('Stiff-Leg Deadlift', 'Hamstrings', 'Glutes & hips,Back', 'Barbell', 'weighted'),
  ('Single-Leg Romanian Deadlift', 'Hamstrings', 'Glutes & hips', 'Dumbbell', 'weighted'),
  ('Lying Leg Curl', 'Hamstrings', '', 'Machine', 'weighted'),
  ('Seated Leg Curl', 'Hamstrings', '', 'Machine', 'weighted'),
  ('Nordic Curl', 'Hamstrings', '', 'None', 'bodyweight'),
  ('Glute-Ham Raise', 'Hamstrings', 'Glutes & hips', 'Machine', 'bodyweight'),
  ('Swiss Ball Leg Curl', 'Hamstrings', 'Glutes & hips', 'Other', 'bodyweight'),

  -- Glutes & hips
  ('Hip Thrust', 'Glutes & hips', 'Hamstrings', 'Barbell', 'weighted'),
  ('Machine Hip Thrust', 'Glutes & hips', 'Hamstrings', 'Machine', 'weighted'),
  ('Glute Bridge', 'Glutes & hips', 'Hamstrings', 'None', 'bodyweight'),
  ('Sumo Deadlift', 'Glutes & hips', 'Hamstrings,Back,Quads', 'Barbell', 'weighted'),
  ('Trap Bar Deadlift', 'Glutes & hips', 'Quads,Back', 'Other', 'weighted'),
  ('Sumo Squat', 'Glutes & hips', 'Quads', 'Dumbbell', 'weighted'),
  ('Cable Pull-Through', 'Glutes & hips', 'Hamstrings', 'Cable', 'weighted'),
  ('Cable Kickback', 'Glutes & hips', '', 'Cable', 'weighted'),
  ('Hip Abduction', 'Glutes & hips', '', 'Machine', 'weighted'),
  ('Hip Adduction', 'Glutes & hips', '', 'Machine', 'weighted'),
  ('Banded Lateral Walk', 'Glutes & hips', '', 'Resistance band', 'bodyweight'),
  ('Clamshell', 'Glutes & hips', '', 'Resistance band', 'bodyweight'),

  -- Calves
  ('Calf Raise', 'Calves', '', 'Machine', 'weighted'),
  ('Seated Calf Raise', 'Calves', '', 'Machine', 'weighted'),
  ('Leg Press Calf Raise', 'Calves', '', 'Machine', 'weighted'),
  ('Dumbbell Calf Raise', 'Calves', '', 'Dumbbell', 'weighted'),
  ('Bodyweight Calf Raise', 'Calves', '', 'None', 'bodyweight'),

  -- Core & abs
  ('Plank', 'Core & abs', 'Shoulders', 'None', 'timed'),
  ('Side Plank', 'Core & abs', 'Shoulders', 'None', 'timed'),
  ('Hollow Hold', 'Core & abs', '', 'None', 'timed'),
  ('Crunch', 'Core & abs', '', 'None', 'bodyweight'),
  ('Cable Crunch', 'Core & abs', '', 'Cable', 'weighted'),
  ('Machine Crunch', 'Core & abs', '', 'Machine', 'weighted'),
  ('Sit Up', 'Core & abs', '', 'None', 'bodyweight'),
  ('Decline Sit Up', 'Core & abs', '', 'None', 'bodyweight'),
  ('Leg Raise', 'Core & abs', '', 'None', 'bodyweight'),
  ('Hanging Leg Raise', 'Core & abs', 'Forearms & grip', 'Pull-up bar', 'bodyweight'),
  ('Hanging Knee Raise', 'Core & abs', 'Forearms & grip', 'Pull-up bar', 'bodyweight'),
  ('Russian Twist', 'Core & abs', '', 'Medicine ball', 'bodyweight'),
  ('Bicycle Crunch', 'Core & abs', '', 'None', 'bodyweight'),
  ('Mountain Climber', 'Core & abs', 'Shoulders,Cardio', 'None', 'timed'),
  ('Ab Wheel Rollout', 'Core & abs', 'Shoulders', 'Other', 'bodyweight'),
  ('Dead Bug', 'Core & abs', '', 'None', 'bodyweight'),
  ('Pallof Press', 'Core & abs', '', 'Cable', 'weighted'),

  -- Full body & conditioning
  ('Clean and Press', 'Full body & conditioning', 'Shoulders,Quads,Back', 'Barbell', 'weighted'),
  ('Power Clean', 'Full body & conditioning', 'Back,Quads', 'Barbell', 'weighted'),
  ('Snatch', 'Full body & conditioning', 'Shoulders,Quads,Back', 'Barbell', 'weighted'),
  ('Thruster', 'Full body & conditioning', 'Quads,Shoulders', 'Barbell', 'weighted'),
  ('Burpee', 'Full body & conditioning', 'Chest,Quads,Cardio', 'None', 'bodyweight'),
  ('Kettlebell Swing', 'Full body & conditioning', 'Glutes & hips,Hamstrings,Back', 'Kettlebell', 'weighted'),
  ('Turkish Get-Up', 'Full body & conditioning', 'Shoulders,Core & abs', 'Kettlebell', 'weighted'),
  ('Medicine Ball Slam', 'Full body & conditioning', 'Core & abs,Shoulders', 'Medicine ball', 'weighted'),
  ('Box Jump', 'Full body & conditioning', 'Quads,Calves', 'Other', 'bodyweight'),
  ('Sandbag Carry', 'Full body & conditioning', 'Forearms & grip,Core & abs', 'Sandbag', 'timed'),
  ('Sled Push', 'Full body & conditioning', 'Quads,Glutes & hips,Calves', 'Sled', 'timed'),
  ('Sled Pull', 'Full body & conditioning', 'Back,Hamstrings', 'Sled', 'timed'),
  ('Battle Rope', 'Full body & conditioning', 'Shoulders,Cardio', 'Other', 'timed'),
  ('Bear Crawl', 'Full body & conditioning', 'Shoulders,Core & abs', 'None', 'timed'),

  -- Cardio
  ('Treadmill', 'Cardio', '', 'Cardio machine', 'cardio'),
  ('Outdoor Run', 'Cardio', '', 'None', 'cardio'),
  ('Walking', 'Cardio', '', 'None', 'cardio'),
  ('Incline Walk', 'Cardio', 'Calves,Glutes & hips', 'Cardio machine', 'cardio'),
  ('Hiking', 'Cardio', 'Quads,Glutes & hips', 'None', 'cardio'),
  ('Outdoor Cycling', 'Cardio', 'Quads', 'Other', 'cardio'),
  ('Stationary Bike', 'Cardio', 'Quads', 'Cardio machine', 'cardio'),
  ('Rowing Machine', 'Cardio', 'Back,Quads', 'Cardio machine', 'cardio'),
  ('Elliptical', 'Cardio', '', 'Cardio machine', 'cardio'),
  ('Stair Climber', 'Cardio', 'Glutes & hips,Calves', 'Cardio machine', 'cardio'),
  ('Swimming', 'Cardio', 'Back,Shoulders', 'None', 'cardio'),
  ('Air Bike', 'Cardio', 'Quads,Shoulders', 'Cardio machine', 'cardio'),
  ('Ski Erg', 'Cardio', 'Back,Shoulders', 'Cardio machine', 'cardio'),
  ('Jump Rope', 'Cardio', 'Calves', 'Other', 'session'),

  -- Sports & classes
  ('Futsal', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Football', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Basketball', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Badminton', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Tennis', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Padel', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Volleyball', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Table Tennis', 'Sports & classes', '', 'None', 'session'),
  ('Boxing', 'Sports & classes', 'Cardio,Shoulders', 'Other', 'session'),
  ('Muay Thai', 'Sports & classes', 'Cardio', 'Other', 'session'),
  ('Martial Arts', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Climbing', 'Sports & classes', 'Back,Forearms & grip', 'Other', 'session'),
  ('HIIT Class', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Spin Class', 'Sports & classes', 'Cardio,Quads', 'Cardio machine', 'session'),
  ('Zumba', 'Sports & classes', 'Cardio', 'None', 'session'),
  ('Circuit Class', 'Sports & classes', 'Cardio', 'Other', 'session'),

  -- Mobility & recovery
  ('Yoga', 'Mobility & recovery', '', 'None', 'session'),
  ('Pilates', 'Mobility & recovery', 'Core & abs', 'None', 'session'),
  ('Stretching', 'Mobility & recovery', '', 'None', 'session'),
  ('Foam Rolling', 'Mobility & recovery', '', 'Other', 'session'),
  ('Dynamic Warm-Up', 'Mobility & recovery', '', 'None', 'session'),
  ('Massage', 'Mobility & recovery', '', 'None', 'session'),
  ('Sauna', 'Mobility & recovery', '', 'None', 'session'),
  ('Ice Bath', 'Mobility & recovery', '', 'None', 'session'),
  ('Hip Flexor Stretch', 'Mobility & recovery', 'Glutes & hips', 'None', 'timed'),
  ('Hamstring Stretch', 'Mobility & recovery', 'Hamstrings', 'None', 'timed'),
  ('Pigeon Pose', 'Mobility & recovery', 'Glutes & hips', 'None', 'timed'),
  ('Cat-Cow', 'Mobility & recovery', 'Back', 'None', 'timed'),
  ('Shoulder Dislocate', 'Mobility & recovery', 'Shoulders', 'Resistance band', 'bodyweight'),
  ('Thoracic Rotation', 'Mobility & recovery', 'Back', 'None', 'bodyweight'),
  ('Ankle Mobility Drill', 'Mobility & recovery', 'Calves', 'None', 'timed')
) as library (name, category, others, equipment, kind);
