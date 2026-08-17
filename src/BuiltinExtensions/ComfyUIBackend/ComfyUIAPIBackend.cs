using FreneticUtilities.FreneticDataSyntax;
using Newtonsoft.Json.Linq;
using SwarmUI.Backends;
using SwarmUI.Core;
using SwarmUI.DataHolders;
using SwarmUI.Utils;
using System.Net.Http;

namespace SwarmUI.Builtin_ComfyUIBackend;

public class ComfyUIAPIBackend : ComfyUIAPIAbstractBackend
{
    public class ComfyUIAPISettings : AutoConfiguration
    {
        /// <summary>Base web address of the ComfyUI instance.</summary>
        [SuggestionPlaceholder(Text = "ComfyUI's address, for example http://127.0.0.1:8188...")]
        [ConfigComment("The address of the ComfyUI instance, for example 'http://127.0.0.1:8188'. A scheme is added automatically when omitted. Leave empty to disable this backend.")]
        public string Address = "";

        /// <summary>Whether this backend may remain idle while its ComfyUI API is unavailable.</summary>
        [ConfigComment("Whether the backend is allowed to revert to an 'idle' state if the API address is unresponsive.\nAn idle state is not considered an error, but cannot generate.\nIt will automatically return to 'running' if the API becomes available.")]
        public bool AllowIdle = false;

        /// <summary>Number of additional requests that may wait behind the active request.</summary>
        [ConfigComment("How many extra requests may queue up on this backend while one is processing.")]
        public int OverQueue = 1;

        /// <summary>Controls whether ComfyUI API requests use an '/api' prefix or root routes.</summary>
        [ConfigComment("Which ComfyUI API route style to use.\nComfyUI 0.33.0 serves its native API at root routes. Some frontend development servers and reverse proxies expose the same API under '/api'.\n'Auto Detect' validates '/api/system_stats' as ComfyUI JSON and otherwise uses root routes. Force a mode only when the deployment requires it.")]
        [ManualSettingsOptions(Impl = null, Vals = ["Auto", "API", "Root"], ManualNames = ["Auto Detect", "Force /api Prefix", "Force Root Routes"])]
        public string APIPathMode = "Auto";

        /// <summary>Legacy switch that forces the '/api' prefix for a ComfyUI frontend development server.</summary>
        [ConfigComment("Legacy compatibility option for a frontend NPM development server. If true, API calls are forced through '/api'. Most users should leave this false and use API Path Mode 'Auto Detect'.")]
        public bool EnableFrontendDev = false;
    }

    /// <summary>Typed settings for this backend.</summary>
    public ComfyUIAPISettings Settings => SettingsRaw as ComfyUIAPISettings;

    /// <summary>Whether the current connection resolved to ComfyUI's prefixed API routes.</summary>
    public bool ResolvedUseAPIPrefix = false;

    /// <summary>Normalized ComfyUI base URL without a trailing slash or '/api' suffix.</summary>
    public string NormalizedAddress
    {
        get
        {
            string address = Settings.Address?.Trim().TrimEnd('/') ?? "";
            if (string.IsNullOrWhiteSpace(address))
            {
                return "";
            }
            if (!address.Contains("://"))
            {
                address = $"http://{address}";
            }
            if (address.EndsWith("/api", StringComparison.OrdinalIgnoreCase))
            {
                address = address[..^4].TrimEnd('/');
            }
            return address;
        }
    }

    /// <inheritdoc/>
    public override string APIAddress
    {
        get
        {
            string address = NormalizedAddress;
            return string.IsNullOrWhiteSpace(address) ? "" : address + (ResolvedUseAPIPrefix || Settings.EnableFrontendDev ? "/api" : "");
        }
    }

    /// <inheritdoc/>
    public override string WebAddress => NormalizedAddress;

    /// <inheritdoc/>
    public override bool CanIdle => Settings.AllowIdle;

    /// <inheritdoc/>
    public override int OverQueue => Settings.OverQueue;

    /// <summary>Returns whether the user supplied an address that explicitly ends with '/api'.</summary>
    private bool AddressIncludesAPIPrefix()
    {
        return (Settings.Address ?? "").Trim().TrimEnd('/').EndsWith("/api", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Returns whether route selection should be discovered automatically.</summary>
    private bool IsAutoPathMode()
    {
        if (Settings.EnableFrontendDev || AddressIncludesAPIPrefix())
        {
            return false;
        }
        string mode = Settings.APIPathMode?.Trim() ?? "Auto";
        return !mode.Equals("API", StringComparison.OrdinalIgnoreCase) && !mode.Equals("Root", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Probes the prefixed system-stats route and verifies that the response is ComfyUI JSON.</summary>
    private async Task<bool> ProbeAPIPrefix()
    {
        string address = NormalizedAddress;
        if (string.IsNullOrWhiteSpace(address))
        {
            return false;
        }
        using CancellationTokenSource cancel = Utilities.TimedCancel(TimeSpan.FromSeconds(10));
        try
        {
            using HttpResponseMessage response = await HttpClient.GetAsync($"{address}/api/system_stats", cancel.Token);
            if (!response.IsSuccessStatusCode)
            {
                return false;
            }
            JObject stats = await NetworkBackendUtils.Parse<JObject>(response);
            return stats["system"] is JObject system && !string.IsNullOrWhiteSpace(system["comfyui_version"]?.ToString());
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (SwarmReadableErrorException)
        {
            return false;
        }
        catch (OperationCanceledException) when (!Program.GlobalProgramCancel.IsCancellationRequested)
        {
            return false;
        }
    }

    /// <summary>Resolves the preferred route style.</summary>
    private async Task<bool> ResolveUseAPIPrefix()
    {
        if (Settings.EnableFrontendDev)
        {
            return true;
        }
        string mode = Settings.APIPathMode?.Trim() ?? "Auto";
        if (mode.Equals("API", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        if (mode.Equals("Root", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        if (AddressIncludesAPIPrefix())
        {
            return true;
        }
        return await ProbeAPIPrefix();
    }

    /// <summary>Returns a human-readable label for the selected route style.</summary>
    private string RouteLabel()
    {
        return ResolvedUseAPIPrefix ? "the /api prefix" : "root routes";
    }

    /// <summary>Allows an idle Auto Detect backend to re-evaluate its route style when reconnecting.</summary>
    private void ConfigureIdleRouteRediscovery(bool autoPathMode)
    {
        if (!CanIdle || !autoPathMode || Idler is null)
        {
            return;
        }
        Idler.ValidateCall = () =>
        {
            if (Status == BackendStatus.IDLE)
            {
                bool prior = ResolvedUseAPIPrefix;
                ResolvedUseAPIPrefix = ResolveUseAPIPrefix().GetAwaiter().GetResult();
                if (prior != ResolvedUseAPIPrefix)
                {
                    Logs.Debug($"ComfyUI API backend {BackendData.ID} changed auto-detected route style to {RouteLabel()} while reconnecting.");
                }
            }
            using CancellationTokenSource cancel = Utilities.TimedCancel(TimeSpan.FromMinutes(1));
            SendGet<JObject>("features", cancel.Token).GetAwaiter().GetResult();
        };
    }

    /// <inheritdoc/>
    public override async Task Init()
    {
        bool autoPathMode = IsAutoPathMode();
        ResolvedUseAPIPrefix = await ResolveUseAPIPrefix();
        if (!string.IsNullOrWhiteSpace(NormalizedAddress))
        {
            AddLoadStatus($"ComfyUI API route resolved to {RouteLabel()}.");
        }
        try
        {
            await InitInternal(CanIdle);
        }
        catch (Exception ex) when (autoPathMode && ResolvedUseAPIPrefix && ex is not OperationCanceledException)
        {
            AddLoadStatus("The prefixed ComfyUI API failed during initialization; retrying root routes.");
            ResolvedUseAPIPrefix = false;
            await InitInternal(CanIdle);
        }
        if (autoPathMode && ResolvedUseAPIPrefix && Status != BackendStatus.RUNNING)
        {
            AddLoadStatus("The prefixed ComfyUI API remained unavailable; retrying root routes.");
            ResolvedUseAPIPrefix = false;
            await InitInternal(CanIdle);
        }
        ConfigureIdleRouteRediscovery(autoPathMode);
    }
}
