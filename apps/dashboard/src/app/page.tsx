"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useToast } from "@/components/toast-provider";
import { CardSkeleton, TableRowSkeleton } from "@/components/ui/skeleton";
import { formatUptime, formatTimestamp } from "@/lib/utils";
interface HealthStatus {
  healthy: boolean;
  whatsapp: 'connected' | 'connecting';
  whatsappQr: string | null;
  messagesToday: number;
  targetGroups: number;
  uptime: number;
}

interface ScraperHealth {
  source_id: string;
  source_type: string;
  last_success: number;
  last_attempt: number;
  error_count: number;
}

export default function Dashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const showExampleToast = () => {
    toast('Dashboard refreshed successfully!', 'success');
  };

  const { data: health, isLoading: healthLoading } = useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: () => apiRequest<HealthStatus>('/health'),
  });

  const { data: scraperHealth, isLoading: scraperLoading } = useQuery<ScraperHealth[]>({
    queryKey: ['scraper-health'],
    queryFn: () => apiRequest<ScraperHealth[]>('/api/health'),
  });

  const formatTimeAgo = formatTimestamp;

  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline">v1.0.0</Badge>
          <Button variant="outline" size="sm">Refresh</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card title="WhatsApp Status">
          {healthLoading ? (
            <CardSkeleton />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Connection</span>
                <Badge
                  variant={health?.whatsapp === 'connected' ? 'success' : 'warning'}
                >
                  {health?.whatsapp === 'connected' ? 'Connected' : 'Connecting'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Messages Today</span>
                <span className="text-sm text-muted-foreground">
                  {health?.messagesToday || '0'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Target Groups</span>
                <span className="text-sm text-muted-foreground">
                  {health?.targetGroups || '0'}
                </span>
              </div>
            </div>
          )}
        </Card>

        <Card title="Scraper Health">
          {scraperLoading ? (
            <CardSkeleton />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Healthy Scrapers</span>
                <span className="text-sm font-medium">
                  {scraperHealth?.filter(s => s.error_count === 0).length || 0} / {scraperHealth?.length || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Errors</span>
                <span className="text-sm text-muted-foreground">
                  {scraperHealth?.reduce((sum, s) => sum + s.error_count, 0) || 0}
                </span>
              </div>
            </div>
          )}
        </Card>

        <Card title="System Status">
          {healthLoading ? (
            <CardSkeleton />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Uptime</span>
                <span className="text-sm text-muted-foreground">
                  {health?.uptime ? formatUptime(health.uptime) : '0m'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Health Check</span>
                <Badge variant={health?.healthy ? 'success' : 'destructive'}>
                  {health?.healthy ? 'Healthy' : 'Unhealthy'}
                </Badge>
              </div>
            </div>
          )}
        </Card>

        <Card title="Quick Actions">
          <div className="flex flex-col gap-2">
            <Button variant="default" size="sm" onClick={showExampleToast}>Trigger All Briefs</Button>
            <Button variant="outline" size="sm">View Logs</Button>
            <Button variant="ghost" size="sm">System Settings</Button>
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Search sources..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <Card title="Scraper Health">
        {scraperLoading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Source</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-left py-3 px-4 font-medium">Last Success</th>
                  <th className="text-left py-3 px-4 font-medium">Last Attempt</th>
                  <th className="text-left py-3 px-4 font-medium">Errors</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRowSkeleton key={i} cols={6} />
                ))}
              </tbody>
            </table>
          </div>
        ) : scraperHealth?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No scraper health data yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Source</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-left py-3 px-4 font-medium">Last Success</th>
                  <th className="text-left py-3 px-4 font-medium">Last Attempt</th>
                  <th className="text-left py-3 px-4 font-medium">Errors</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {scraperHealth?.
                  filter((s) =>
                    s.source_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    s.source_type.toLowerCase().includes(searchTerm.toLowerCase())
                  )
                  .map((s) => (
                    <tr key={s.source_id} className="border-b hover:bg-surface-2">
                      <td className="py-3 px-4 font-mono text-xs">{s.source_id}</td>
                      <td className="py-3 px-4">
                        <Badge variant="info" className="text-xs">
                          {s.source_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {s.last_success ? formatTimeAgo(s.last_success) : '\u2014'}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {s.last_attempt ? formatTimeAgo(s.last_attempt) : '\u2014'}
                      </td>
                      <td className="py-3 px-4">
                        {s.error_count > 0 ? (
                          <span className="text-destructive font-medium">
                            {s.error_count}
                          </span>
                        ) : (
                          <span className="text-success">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={s.error_count === 0 ? 'success' : 'destructive'}
                          className="text-xs"
                        >
                          {s.error_count === 0 ? 'Healthy' : 'Errors'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
