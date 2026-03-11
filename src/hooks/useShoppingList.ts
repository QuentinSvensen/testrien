import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface ShoppingGroup {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface ShoppingItem {
  id: string;
  group_id: string | null;
  name: string;
  quantity: string | null;
  brand: string | null;
  checked: boolean;
  sort_order: number;
  created_at: string;
  content_quantity: string | null;
  secondary_checked: boolean;
  content_quantity_type: string | null;
}

const onMutationError = (error: Error) => {
  toast({ title: "Erreur", description: error.message, variant: "destructive" });
};

export function useShoppingList(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shopping_groups"] });
    qc.invalidateQueries({ queryKey: ["shopping_items"] });
  };

  const { data: groups = [] } = useQuery({
    queryKey: ["shopping_groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopping_groups").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      return data as ShoppingGroup[];
    },
    enabled,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["shopping_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopping_items").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      return data as ShoppingItem[];
    },
    enabled,
  });

  const addGroup = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder = groups.reduce((max, g) => Math.max(max, g.sort_order), -1);
      const { error } = await supabase
        .from("shopping_groups").insert({ name, sort_order: maxOrder + 1 });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const renameGroup = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("shopping_groups").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shopping_groups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const reorderGroups = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      await Promise.all(items.map(item =>
        supabase.from("shopping_groups").update({ sort_order: item.sort_order }).eq("id", item.id)
      ));
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const addItem = useMutation({
    mutationFn: async ({ name, group_id }: { name: string; group_id: string | null }) => {
      const groupItems = items.filter(i => i.group_id === group_id);
      const maxOrder = groupItems.reduce((max, i) => Math.max(max, i.sort_order), -1);
      const { error } = await supabase
        .from("shopping_items").insert({ name, group_id, sort_order: maxOrder + 1 });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const toggleItem = useMutation({
    mutationFn: async ({ id, checked }: { id: string; checked: boolean }) => {
      const { error } = await supabase.from("shopping_items").update({ checked }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, checked }) => {
      await qc.cancelQueries({ queryKey: ["shopping_items"] });
      const prev = qc.getQueryData<ShoppingItem[]>(["shopping_items"]);
      qc.setQueryData<ShoppingItem[]>(["shopping_items"], old =>
        old?.map(i => i.id === id ? { ...i, checked } : i) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["shopping_items"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["shopping_items"] }),
  });

  const updateItemQuantity = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: string | null }) => {
      const { error } = await supabase.from("shopping_items").update({ quantity }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const updateItemBrand = useMutation({
    mutationFn: async ({ id, brand }: { id: string; brand: string | null }) => {
      const { error } = await supabase.from("shopping_items").update({ brand }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const updateItemContentQuantity = useMutation({
    mutationFn: async ({ id, content_quantity }: { id: string; content_quantity: string | null }) => {
      const { error } = await supabase.from("shopping_items").update({ content_quantity }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const toggleSecondaryCheck = useMutation({
    mutationFn: async ({ id, secondary_checked }: { id: string; secondary_checked: boolean }) => {
      const { error } = await supabase.from("shopping_items").update({ secondary_checked }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, secondary_checked }) => {
      await qc.cancelQueries({ queryKey: ["shopping_items"] });
      const prev = qc.getQueryData<ShoppingItem[]>(["shopping_items"]);
      qc.setQueryData<ShoppingItem[]>(["shopping_items"], old =>
        old?.map(i => i.id === id ? { ...i, secondary_checked } : i) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["shopping_items"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["shopping_items"] }),
  });

  const updateItemContentQuantityType = useMutation({
    mutationFn: async ({ id, content_quantity_type }: { id: string; content_quantity_type: string | null }) => {
      const { error } = await supabase.from("shopping_items").update({ content_quantity_type }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const renameItem = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("shopping_items").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const moveItem = useMutation({
    mutationFn: async ({ id, group_id }: { id: string; group_id: string | null }) => {
      const { error } = await supabase.from("shopping_items").update({ group_id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const reorderItems = useMutation({
    mutationFn: async (updates: { id: string; sort_order: number; group_id: string | null }[]) => {
      await Promise.all(updates.map(u =>
        supabase.from("shopping_items").update({ sort_order: u.sort_order, group_id: u.group_id }).eq("id", u.id)
      ));
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shopping_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const getItemsByGroup = (groupId: string | null) =>
    items.filter(i => i.group_id === groupId).sort((a, b) => a.sort_order - b.sort_order);

  const ungroupedItems = items.filter(i => !i.group_id).sort((a, b) => a.sort_order - b.sort_order);

  return {
    groups, items, ungroupedItems,
    addGroup, renameGroup, deleteGroup, reorderGroups,
    addItem, toggleItem, updateItemQuantity, updateItemBrand, updateItemContentQuantity, toggleSecondaryCheck, updateItemContentQuantityType, renameItem, moveItem, deleteItem,
    reorderItems,
    getItemsByGroup,
  };
}
