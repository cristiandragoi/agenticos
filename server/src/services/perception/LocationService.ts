/**
 * LocationService.ts — Jarvis Location Access Capability
 *
 * Implements Section 14 of the AgenticOS Production Specification:
 * - Treats location as a first-class capability: location.read.
 * - Distinguishes between:
 *   permission_granted | permission_denied | location_unavailable | stale_location | current_verified.
 * - Queries Windows location sensors or IP-geolocation fallback.
 * - Never claims omniscience; only returns verified location data.
 * - User-controllable and revocable permission.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import { rawDb } from '../../db/index.js';

const execAsync = promisify(exec);

export type LocationPermissionState =
  | 'permission_granted'
  | 'permission_denied'
  | 'location_unavailable'
  | 'stale_location'
  | 'current_verified';

export interface LocationResult {
  state: LocationPermissionState;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  provider: 'windows_geolocator' | 'network_ip' | 'cached' | 'none';
  timestamp: string;
  summary: string;
}

export class LocationService {
  private static instance: LocationService;
  private locationEnabled: boolean = true;
  private cachedLocation: LocationResult | null = null;
  private readonly STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  private constructor() {
    this.initSettings();
  }

  public static getInstance(): LocationService {
    if (!LocationService.instance) {
      LocationService.instance = new LocationService();
    }
    return LocationService.instance;
  }

  private initSettings(): void {
    try {
      const row: any = rawDb.prepare("SELECT value FROM system_secrets WHERE key = 'location_permission_enabled'").get();
      if (row?.value) {
        this.locationEnabled = row.value === 'true';
      }
    } catch {
      this.locationEnabled = true;
    }
  }

  public isEnabled(): boolean {
    return this.locationEnabled;
  }

  public setEnabled(enabled: boolean): void {
    this.locationEnabled = enabled;
    try {
      rawDb.prepare(`
        INSERT INTO system_secrets (key, value, updated_at)
        VALUES ('location_permission_enabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(enabled ? 'true' : 'false', new Date().toISOString());
    } catch {}
    if (!enabled) {
      this.cachedLocation = null;
    }
    logger.info(`[LocationService] Location permission updated: enabled=${enabled}`);
  }

  /**
   * Read current verified location across available OS or network sensors.
   */
  public async readLocation(): Promise<LocationResult> {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // 1. Permission check
    if (!this.locationEnabled) {
      return {
        state: 'permission_denied',
        provider: 'none',
        timestamp: nowIso,
        summary: 'Location access is currently disabled in your Jarvis settings. You can grant location access at any time.',
      };
    }

    // 2. Windows Location API probe via PowerShell
    if (process.platform === 'win32') {
      try {
        const psScript = `
          Add-Type -AssemblyName System.Device
          $watcher = New-Object System.Device.Location.GeoCoordinateWatcher
          $watcher.Start()
          $cnt = 0
          while (($watcher.Status -ne [System.Device.Location.GeoPositionStatus]::Ready) -and ($cnt -lt 15)) {
            Start-Sleep -Milliseconds 100
            $cnt++
          }
          if ($watcher.Status -eq [System.Device.Location.GeoPositionStatus]::Ready) {
            $pos = $watcher.Position.Location
            @{
              Latitude = $pos.Latitude
              Longitude = $pos.Longitude
              HorizontalAccuracy = $pos.HorizontalAccuracy
            } | ConvertTo-Json
          } else {
            "UNAVAILABLE"
          }
          $watcher.Stop()
        `;
        const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript.trim()}"`, { timeout: 4000 });
        if (stdout && !stdout.includes('UNAVAILABLE') && stdout.trim().startsWith('{')) {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.Latitude && parsed.Longitude && parsed.Latitude !== 0) {
            const res: LocationResult = {
              state: 'current_verified',
              latitude: parsed.Latitude,
              longitude: parsed.Longitude,
              accuracyMeters: parsed.HorizontalAccuracy || 50,
              provider: 'windows_geolocator',
              timestamp: nowIso,
              summary: `Current verified location retrieved via Windows Geolocator: (${parsed.Latitude.toFixed(4)}, ${parsed.Longitude.toFixed(4)}).`,
            };
            this.cachedLocation = res;
            return res;
          }
        }
      } catch (err: any) {
        logger.warn(`[LocationService] Windows Geolocator probe error: ${err?.message}`);
      }
    }

    // 3. Network IP Geolocation Fallback
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('http://ip-api.com/json/?fields=status,country,regionName,city,lat,lon,timezone', {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          const locRes: LocationResult = {
            state: 'current_verified',
            city: data.city,
            region: data.regionName,
            country: data.country,
            latitude: data.lat,
            longitude: data.lon,
            accuracyMeters: 5000,
            provider: 'network_ip',
            timestamp: nowIso,
            summary: `Current verified location: ${data.city}, ${data.regionName}, ${data.country} (approx. coordinates: ${data.lat}, ${data.lon}).`,
          };
          this.cachedLocation = locRes;
          return locRes;
        }
      }
    } catch (netErr: any) {
      logger.warn(`[LocationService] Network IP geolocation error: ${netErr?.message}`);
    }

    // 4. Cached location check
    if (this.cachedLocation) {
      const cachedMs = new Date(this.cachedLocation.timestamp).getTime();
      const isStale = (nowMs - cachedMs) > this.STALE_THRESHOLD_MS;
      return {
        ...this.cachedLocation,
        state: isStale ? 'stale_location' : 'current_verified',
        provider: 'cached',
        summary: `Cached location (${isStale ? 'stale' : 'recent'}): ${this.cachedLocation.city || ''}, ${this.cachedLocation.country || ''}.`,
      };
    }

    // 5. Truly location unavailable
    return {
      state: 'location_unavailable',
      provider: 'none',
      timestamp: nowIso,
      summary: 'Location access is enabled, but sensors and network geolocation are currently unreachable.',
    };
  }
}

export const locationService = LocationService.getInstance();
