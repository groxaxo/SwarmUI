using FreneticUtilities.FreneticDataSyntax;
using SwarmUI.Backends;
using SwarmUI.DataHolders;
using SwarmUI.Utils;
using System.Net.Http;

namespace SwarmUI.Builtin_ComfyUIBackend;

public class ComfyUIAPIBackend : ComfyUIAPIAbstractBackend
{
    public class ComfyUIAPISettings : AutoConfiguration
    {
        /// <summary>Base web address of the ComfyUI instance.</summary>
        [SuggestionPlaceholder(Text = "ComfyUI's address...")]
        [ConfigComment("The address of the ComfyUI instance, for example 'http://127.0.0.1:8188'. A scheme is added automatically when omitted.")]
        public string Address = "http://127.0.0.1:8188";

        /// <summary>Whether this backend may remain idle while its ComfyUI API is unavailable.</summary>
        [ConfigComment("Whether the backend is allowed to revert to an 'idle' state if the API address is unresponsive.\nAn idle state is not considered an error, but cannot generate.\nIt will automatically return to 'running' if the API becomes available.")]
        public bool AllowIdle = false;

        /// <summary>Number of additional requests that may wait behind the active request.</summary>
        [ConfigComment("How many extra requests may queue up on this backend while one is processing.")]
        public int OverQueue = 1;

        /// <summary>Controls whether ComfyUI API requests use the current '/api' prefix or the legacy root routes.</summary>
        [ConfigComment("Which ComfyUI API route style to use.\n'Auto Detect' prefers the current '/api' routes when available and falls back to legacy root routes.\nForce a mode only when a reverse proxy or older ComfyUI installation requires it.")]
        [ManualSettingsOptions(Impl = null, Vals = ["Auto", "API", "Root"], ManualNames = ["Auto Detect", "Force /api Prefix", "Force Legacy Root"])]
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
                address = "http://127.0.0.1:8188";
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
    public override string APIAddress => NormalizedAddress + (ResolvedUseAPIPrefix || Settings.EnableFrontendDev ? "/api" : "");

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

    /// <summary>Resolves the preferred route style, probing the small system-stats endpoint when automatic discovery is enabled.</summary>
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
        using CancellationTokenSource cancel = Utilities.TimedCancel(TimeSpan.FromSeconds(10));
        try
        {
            using HttpResponseMessage response = await HttpClient.GetAsync($"{NormalizedAddress}/api/system_stats", cancel.Token);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    /// <inheritdoc/>
    public override async Task Init()
    {
        bool autoPathMode = IsAutoPathMode();
        ResolvedUseAPIPrefix = await ResolveUseAPIPrefix();
        AddLoadStatus($"ComfyUI API route resolved to {(ResolvedUseAPIPrefix ? "the /api prefix" : "legacy root routes")}.");
        try
        {
            await InitInternal(CanIdle);
        }
        catch (Exception ex) when (autoPathMode && ResolvedUseAPIPrefix && ex is not OperationCanceledException)
        {
            AddLoadStatus("The prefixed ComfyUI API failed during initialization; retrying legacy root routes.");
            ResolvedUseAPIPrefix = false;
            await InitInternal(CanIdle);
            return;
        }
        if (autoPathMode && ResolvedUseAPIPrefix && Status != BackendStatus.RUNNING)
        {
            AddLoadStatus("The prefixed ComfyUI API remained unavailable; retrying legacy root routes.");
            ResolvedUseAPIPrefix = false;
            await InitInternal(CanIdle);
        }
    }
}
