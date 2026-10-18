using AssetStudio;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// A bounded, read-only Unity reader. Audio payloads are decoded by vgmstream,
// never by AssetStudioUtility / FMOD. stdout is exactly one JSON document.
if (args.Length != 3) throw new ArgumentException("AudioInventory <input-list.json> <game-root> <output-root>");
var game = Resolve(args[1]);
var output = Resolve(args[2]);
if (Inside(output, game) || Inside(game, output)) throw new ArgumentException("Output and game directories must not overlap.");
var inputs = JsonSerializer.Deserialize<string[]>(File.ReadAllText(args[0])) ?? [];
foreach (var input in inputs)
    if (!Inside(Resolve(input), game)) throw new ArgumentException("Input is outside the game directory.");
Directory.CreateDirectory(output);
var logs = new CaptureLogger();
Logger.Default = logs;
var manager = new AssetsManager { LoadViaTypeTree = false };
manager.SetAssetFilter(new[] { ClassIDType.AudioClip, ClassIDType.AssetBundle });
manager.LoadFilesAndFolders(inputs);
var containers = new Dictionary<AssetStudio.Object, string>();
foreach (var sf in manager.AssetsFileList)
    foreach (var bundle in sf.Objects.OfType<AssetBundle>())
        foreach (var kv in bundle.m_Container)
            if (kv.Value.asset.TryGet(out var obj, sf)) containers[obj] = kv.Key;
var loaded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
var assets = new List<object>();
foreach (var sf in manager.AssetsFileList)
{
    var original = Resolve(String.IsNullOrWhiteSpace(sf.originalPath) ? sf.fullName : sf.originalPath);
    if (!Inside(original, game)) continue;
    loaded.Add(original);
    foreach (var clip in sf.Objects.OfType<AudioClip>())
    {
        var bundle = Path.GetRelativePath(game, original).Replace('\\', '/');
        var status = "success";
        string? error = null, rawPath = null, payloadHash = null;
        try
        {
            var data = clip.m_AudioData.GetData();
            if (data.Length == 0) throw new InvalidDataException("Empty audio payload.");
            payloadHash = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
            var magic = Encoding.ASCII.GetString(data, 0, Math.Min(data.Length, 4));
            var ext = magic switch { "FSB5" or "FSB4" => ".fsb", "OggS" => ".ogg", "RIFF" => ".wav", "fLaC" => ".flac", _ => ".bin" };
            rawPath = "raw/" + payloadHash + ext;
            WriteAtomic(Path.Combine(output, rawPath), data, output, game);
        }
        catch (Exception ex) { status = "failed"; error = ex.Message; }
        assets.Add(new {
            name = clip.m_Name, path_id = clip.m_PathID.ToString(),
            source = new { bundle, serialized_file = sf.fileName, container = containers.GetValueOrDefault(clip, ""), unity_version = sf.version.ToString() },
            raw_path = rawPath, payload_hash = payloadHash, status, error,
            source_metadata = new { sample_rate = clip.m_Frequency, channels = clip.m_Channels, duration_seconds = clip.m_Length, compression = clip.m_CompressionFormat.ToString(), subsound_index = clip.m_SubsoundIndex }
        });
    }
}
var result = new {
    assets,
    inputs = inputs.Select(p => new { path = Path.GetRelativePath(game, Resolve(p)).Replace('\\', '/'), loaded = loaded.Contains(Resolve(p)) }).ToArray(),
    log = logs.Messages
};
Console.WriteLine(JsonSerializer.Serialize(result));
manager.Clear();

static bool Inside(string path, string root) => String.Equals(path, root, StringComparison.OrdinalIgnoreCase) || path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
static string Resolve(string value)
{
    var full = Path.GetFullPath(value);
    var root = Path.GetPathRoot(full)!;
    foreach (var part in full[root.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
    {
        root = Path.Combine(root, part);
        FileSystemInfo entry = Directory.Exists(root) ? new DirectoryInfo(root) : new FileInfo(root);
        if (entry.Exists && (entry.Attributes & FileAttributes.ReparsePoint) != 0)
            root = (entry.ResolveLinkTarget(true) ?? throw new IOException("Unresolved link: " + root)).FullName;
    }
    return Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
}
static void WriteAtomic(string path, byte[] data, string output, string game)
{
    path = Resolve(path);
    if (!Inside(path, output) || Inside(path, game)) throw new IOException("Unsafe output path.");
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    var temporary = path + ".tmp-" + Environment.ProcessId;
    if (File.Exists(temporary)) File.Delete(temporary);
    using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) stream.Write(data);
    File.Move(temporary, path, true);
}
sealed class CaptureLogger : ILogger
{
    public List<string> Messages = [];
    public void Log(LoggerEvent ev, string msg, bool ignoreLevel)
    {
        if (Messages.Count < 100 && (ev.ToString().Contains("Error") || ev.ToString().Contains("Warning"))) Messages.Add(ev + ": " + msg);
    }
}
