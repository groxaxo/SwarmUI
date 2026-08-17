using SwarmUI.Core;

namespace SwarmUI.Builtin_ComfyUIBackend;

/// <summary>Keeps Swarm-managed ComfyUI backends aligned with the ComfyUI 0.33.0 dependency and model-folder contract.</summary>
public class ComfyUICompatibilityExtension : Extension
{
    /// <summary>ComfyUI release used as the compatibility baseline for this manifest.</summary>
    public const string CompatibleComfyUIVersion = "0.33.0";

    /// <summary>Frontend package pinned by ComfyUI 0.33.0.</summary>
    public const string TargetFrontendVersion = "1.48.7";

    /// <inheritdoc/>
    public override void OnFirstInit()
    {
        ComfyUISelfStartBackend.SwarmValidatedFrontendVersion = TargetFrontendVersion;

        UpsertRequiredPackage("comfyui_frontend_package", $"comfyui-frontend-package=={TargetFrontendVersion}");
        UpsertRequiredPackage("einops", "einops");
        UpsertRequiredPackage("tokenizers", "tokenizers");
        UpsertRequiredPackage("safetensors", "safetensors");
        UpsertRequiredPackage("yaml", "pyyaml");
        UpsertRequiredPackage("pil", "Pillow");
        UpsertRequiredPackage("scipy", "scipy");
        UpsertRequiredPackage("tqdm", "tqdm");
        UpsertRequiredPackage("psutil", "psutil");
        UpsertRequiredPackage("sqlalchemy", "SQLAlchemy");

        UpsertVersionRequirement("tokenizers", "tokenizers", ">=", "0.13.3");
        UpsertVersionRequirement("safetensors", "safetensors", ">=", "0.4.2");
        UpsertVersionRequirement("pydantic", "pydantic", ">=", "2.0.0");
        UpsertVersionRequirement("pydantic_settings", "pydantic-settings", ">=", "2.0.0");
        UpsertVersionRequirement("av", "av", ">=", "14.2.0");
        UpsertVersionRequirement("kornia", "kornia", ">=", "0.7.1");

        AddModelFolderForward("configs");
        AddModelFolderForward("text_encoders;clip;CLIP");
        AddModelFolderForward("diffusers");
        AddModelFolderForward("vae_approx");
        AddModelFolderForward("datasets");
        AddModelFolderForward("photomaker");
        AddModelFolderForward("classifiers");
        AddModelFolderForward("model_patches");
        AddModelFolderForward("audio_encoders");
        AddModelFolderForward("background_removal");
        AddModelFolderForward("frame_interpolation");
        AddModelFolderForward("geometry_estimation");
        AddModelFolderForward("optical_flow");
        AddModelFolderForward("detection");
    }

    /// <summary>Adds or replaces a required package by its normalized site-packages folder identifier.</summary>
    private static void UpsertRequiredPackage(string libFolder, string pipName)
    {
        List<(string, string)> packages = ComfyUISelfStartBackend.RequiredPythonPackages;
        int index = packages.FindIndex(package => package.Item1 == libFolder);
        (string, string) requirement = (libFolder, pipName);
        if (index >= 0)
        {
            packages[index] = requirement;
        }
        else
        {
            packages.Add(requirement);
        }
    }

    /// <summary>Adds or replaces a versioned package requirement by its normalized site-packages folder identifier.</summary>
    private static void UpsertVersionRequirement(string libFolder, string pipName, string relation, string version)
    {
        List<(string, string, string, string)> packages = ComfyUISelfStartBackend.RequiredVersionPythonPackages;
        int index = packages.FindIndex(package => package.Item1 == libFolder);
        (string, string, string, string) requirement = (libFolder, pipName, relation, version);
        if (index >= 0)
        {
            packages[index] = requirement;
        }
        else
        {
            packages.Add(requirement);
        }
    }

    /// <summary>Adds a ComfyUI model-folder mapping without duplicating an existing YAML key.</summary>
    private static void AddModelFolderForward(string definition)
    {
        int separator = definition.IndexOf(';');
        string key = separator < 0 ? definition : definition[..separator];
        bool exists = ComfyUISelfStartBackend.FoldersToForwardInComfyPath.Any(existing =>
        {
            int existingSeparator = existing.IndexOf(';');
            string existingKey = existingSeparator < 0 ? existing : existing[..existingSeparator];
            return existingKey == key;
        });
        if (!exists)
        {
            ComfyUISelfStartBackend.FoldersToForwardInComfyPath.Add(definition);
        }
    }
}
