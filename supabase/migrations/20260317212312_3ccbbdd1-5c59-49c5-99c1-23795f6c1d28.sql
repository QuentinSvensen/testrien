
CREATE OR REPLACE FUNCTION public.batch_reorder_meals(items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE meals SET sort_order = (item->>'sort_order')::int
  FROM jsonb_array_elements(items) AS item
  WHERE meals.id = (item->>'id')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.batch_reorder_possible_meals(items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE possible_meals SET sort_order = (item->>'sort_order')::int
  FROM jsonb_array_elements(items) AS item
  WHERE possible_meals.id = (item->>'id')::uuid;
END;
$$;
