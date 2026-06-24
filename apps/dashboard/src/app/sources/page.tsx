"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/data-table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/toast-provider";
import { Plus, Trash2 } from "lucide-react";

interface Source extends Record<string, unknown> {
  id: number;
  name: string;
  source_id: string;
  type: string;
  is_active: boolean;
}

const SOURCE_TYPE_OPTIONS = [
  { value: "forum", label: "Forum" },
  { value: "deals", label: "Deals" },
  { value: "reddit", label: "Reddit" },
  { value: "youtube", label: "YouTube" },
  { value: "whatsapp", label: "WhatsApp" },
];

export default function SourcesPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [editTypeId, setEditTypeId] = useState<number | null>(null);
  const [editTypeValue, setEditTypeValue] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", source_id: "", type: "forum" });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sources = [], isLoading } = useQuery<Source[]>({
    queryKey: ["sources"],
    queryFn: () => apiRequest<Source[]>("/api/sources"),
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof form) =>
      apiRequest("/api/sources", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      setAddOpen(false);
      setForm({ name: "", source_id: "", type: "forum" });
      toast("Source created", "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      apiRequest(`/api/sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast("Source updated", "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const updateTypeMutation = useMutation({
    mutationFn: ({ id, type }: { id: number; type: string }) =>
      apiRequest(`/api/sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ type }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      setEditTypeId(null);
      setEditTypeValue("");
      toast("Source type updated", "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/sources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      setDeleteId(null);
      toast("Source deleted", "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const columns: Column<Source>[] = [
    { key: "id", header: "ID", sortable: true, className: "w-16" },
    { key: "name", header: "Name", sortable: true },
    {
      key: "source_id",
      header: "Source ID",
      sortable: true,
      render: (item) => (
        <span className="font-mono text-xs">{item.source_id}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortable: true,
      render: (item) =>
        editTypeId === item.id ? (
          <div className="flex items-center gap-2">
            <Select
              value={editTypeValue}
              onChange={(e) => setEditTypeValue(e.target.value)}
              options={SOURCE_TYPE_OPTIONS}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                updateTypeMutation.mutate({ id: item.id, type: editTypeValue })
              }
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditTypeId(null)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Badge
            variant={item.type === "whatsapp" ? "info" : "secondary"}
            className="cursor-pointer"
            onClick={() => {
              setEditTypeId(item.id);
              setEditTypeValue(item.type);
            }}
          >
            {item.type}
          </Badge>
        ),
    },
    {
      key: "is_active",
      header: "Status",
      render: (item) => (
        <Switch
          checked={item.is_active}
          onChange={(checked) =>
            toggleMutation.mutate({ id: item.id, is_active: checked })
          }
        />
      ),
    },
    {
      key: "id",
      header: "",
      className: "w-12",
      render: (item) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteId(item.id);
          }}
        >
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      ),
    },
  ];

  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sources</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Source
        </Button>
      </div>

      <Card>
        <DataTable<Source>
          columns={columns}
          data={sources}
          keyExtractor={(item) => item.id}
          isLoading={isLoading}
          searchable
          searchPlaceholder="Search sources..."
        />
      </Card>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Source"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Source name"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Source ID</label>
            <Input
              value={form.source_id}
              onChange={(e) => setForm({ ...form, source_id: e.target.value })}
              placeholder="e.g. hotukdeals, wallstreetbets"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Type</label>
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              options={SOURCE_TYPE_OPTIONS}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name || !form.source_id || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Delete Source"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to delete this source? This action cannot be
            undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteId !== null && deleteMutation.mutate(deleteId)
              }
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
