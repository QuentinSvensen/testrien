
-- Add new columns to meals (master list)
ALTER TABLE public.meals ADD COLUMN category text NOT NULL DEFAULT 'plat';
ALTER TABLE public.meals ADD COLUMN calories text;
ALTER TABLE public.meals ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

-- Create possible_meals table (instances in "possibles" lists)
CREATE TABLE public.possible_meals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meal_id uuid NOT NULL REFERENCES public.meals(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  expiration_date date,
  day_of_week text,
  meal_time text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.possible_meals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view possible_meals" ON public.possible_meals FOR SELECT USING (true);
CREATE POLICY "Anyone can insert possible_meals" ON public.possible_meals FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update possible_meals" ON public.possible_meals FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete possible_meals" ON public.possible_meals FOR DELETE USING (true);

-- Migrate existing available meals to possible_meals
INSERT INTO public.possible_meals (meal_id)
SELECT id FROM public.meals WHERE is_available = true;
