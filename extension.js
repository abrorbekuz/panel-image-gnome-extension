// extension.js
import GObject from "gi://GObject";
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import GdkPixbuf from "gi://GdkPixbuf";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// Get Quick Settings elements
let QuickSettingsMenu = null;
let QuickSettingsBox = null;
let QuickSettingsActor = null;

function getQuickSettings() {
  const quickSettings = Main.panel.statusArea.quickSettings;
  if (quickSettings && quickSettings.menu) {
    QuickSettingsMenu = quickSettings.menu;
    QuickSettingsBox = quickSettings.menu.box;
    QuickSettingsActor = quickSettings.menu.actor;
  }
}

// Size (px) of the invisible top-left corner that opens the preferences
const PREFS_CORNER_SIZE = 28;

function cssUrl(path) {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ---- Blurred fill (TikTok style): small cached blurred copy of an image ----
const BLUR_SMALL_WIDTH = 32; // smaller = blurrier
const _blurPending = new Map(); // out path -> Set of callbacks
const _blurFailed = new Set();

function _blurDir() {
  return GLib.build_filenamev([GLib.get_user_cache_dir(), "panel-image"]);
}

function _makeBlur(src, out, done) {
  Gio.File.new_for_path(src).read_async(GLib.PRIORITY_LOW, null, (f, res) => {
    let stream;
    try {
      stream = f.read_finish(res);
    } catch (_e) {
      done(false);
      return;
    }
    // decode straight to a tiny size (in a thread), then smooth it back up
    GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
      stream,
      BLUR_SMALL_WIDTH,
      -1,
      true,
      null,
      (_p, res2) => {
        let ok = false;
        try {
          let pb = GdkPixbuf.Pixbuf.new_from_stream_finish(res2);
          for (let i = 0; i < 3; i++)
            pb = pb.scale_simple(
              pb.get_width() * 2,
              pb.get_height() * 2,
              GdkPixbuf.InterpType.BILINEAR,
            );
          GLib.mkdir_with_parents(_blurDir(), 0o755);
          pb.savev(out, "png", [], []);
          ok = true;
        } catch (e) {
          log(`panel-image: blur failed for ${src}: ${e.message}`);
        }
        try {
          stream.close(null);
        } catch (_e) {
          // ignore
        }
        done(ok);
      },
    );
  });
}

// Returns the blurred file path if ready, else null (and calls onReady later)
function getBlurred(path, onReady) {
  let info;
  try {
    info = Gio.File.new_for_path(path).query_info(
      "time::modified,standard::size",
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
  } catch (_e) {
    return null;
  }

  const key = `${path}|${info.get_attribute_uint64("time::modified")}|${info.get_size()}`;
  const out = GLib.build_filenamev([
    _blurDir(),
    `blur-${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, key, -1)}.png`,
  ]);

  if (GLib.file_test(out, GLib.FileTest.EXISTS)) return out;
  if (_blurFailed.has(out)) return null;

  let waiting = _blurPending.get(out);
  if (waiting) {
    if (onReady) waiting.add(onReady);
    return null;
  }

  waiting = new Set();
  if (onReady) waiting.add(onReady);
  _blurPending.set(out, waiting);
  _makeBlur(path, out, (ok) => {
    _blurPending.delete(out);
    if (!ok) _blurFailed.add(out);
    waiting.forEach((cb) => cb());
  });
  return null;
}

// Image banner widget
const ImageBanner = GObject.registerClass(
  class ImageBanner extends St.Button {
    _init(
      settings,
      { standalone = false, placeholderPath = null, onOpenPrefs = null } = {},
    ) {
      super._init({
        style_class: "image-banner",
        can_focus: true,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
      });

      this._settings = settings;
      this._standalone = standalone;
      this._placeholderPath = placeholderPath;
      this._onOpenPrefs = onOpenPrefs;
      this._marginStyle = "";
      this._currentPath = null;
      this._destroyed = false;
      this._blurCb = () => {
        if (!this._destroyed) this._applyFrameStyle();
      };
      this._currentImageIndex = 0;
      this._hoverImages = [];

      // Create container (holds the image)
      this._container = new St.Bin({
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
      });

      this.set_child(this._container);

      // Update image
      this._updateImage();

      // Setup hover image switching
      this._setupHoverEffect();

      // Click: invisible top-left corner opens preferences, rest runs script
      this.connect("clicked", () => {
        if (this._onOpenPrefs && this._inPrefsCorner()) this._onOpenPrefs();
        else this._executeScript();
      });

      // Listen for settings changes
      this._settingsChangedId = this._settings.connect("changed", () => {
        this._updateImage();
        this._setupHoverEffect();
      });
    }

    // Margin comes from the extension (gap), the rest from settings
    setMargin(css) {
      this._marginStyle = css;
      this._applyFrameStyle();
    }

    // Outer frame: fill color, border, rounded corners
    _applyFrameStyle() {
      const radius = this._radius();
      const fill = this._settings.get_string("fill-color");
      const borderWidth = this._settings.get_int("border-width");
      const borderColor =
        this._settings.get_string("border-color") || "rgba(255,255,255,0.25)";

      let css = `${this._marginStyle} border-radius: ${radius}px;`;

      // Fill: blurred copy of the current image, or a plain color
      let blurred = null;
      if (
        this._settings.get_string("fill-mode") === "image" &&
        this._currentPath
      )
        blurred = getBlurred(this._currentPath, this._blurCb);
      if (blurred)
        css +=
          ` background-image: url("${cssUrl(blurred)}");` +
          " background-size: 100% 100%; background-repeat: no-repeat;" +
          " background-position: center;";
      else if (fill) css += ` background-color: ${fill};`;

      if (borderWidth > 0)
        css += ` border: ${borderWidth}px solid ${borderColor};`;
      this._setStyle(this, css);
    }

    // Corner radius from settings. Never plain 0 (1px looks square but keeps
    // St on the same render path as rounded corners), and never more than
    // half the banner height (bigger radius breaks the corner drawing).
    _radius() {
      const r = this._settings.get_int("corner-radius");
      const h = this._settings.get_int("image-height");
      const half = Math.floor((h > 0 ? h : 100) / 2);
      return Math.max(1, Math.min(r, half));
    }

    // Only touch the style if it really changed (less redraw churn)
    _setStyle(actor, css) {
      if (actor.style !== css) actor.style = css;
    }

    // Images list: default image first, then the others
    _getImages() {
      const list = this._settings.get_strv("images").filter((p) => p);
      if (list.length === 0) return [];
      const def = this._settings.get_string("default-image");
      const first = list.includes(def) ? def : list[0];
      return [first, ...list.filter((p) => p !== first)];
    }

    _buildStyle(imagePath) {
      const height = this._settings.get_int("image-height");
      let width = this._settings.get_int("image-width");
      const radius = this._radius();

      if (this._standalone) {
        // -1 (or too big) = screen width. CSS px are scaled by the shell,
        // so divide the monitor width by the scale factor.
        const monitor = Main.layoutManager.primaryMonitor;
        const sf = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const screenW = Math.floor(monitor.width / sf);
        width = width > 0 ? Math.min(width, screenW) : screenW;
      }

      this._container.x_align =
        width > 0 ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL;

      return `
        background-image: url("${cssUrl(imagePath)}");
        background-size: 100% 100%;
        background-repeat: no-repeat;
        background-position: center;
        border-radius: ${radius}px;
        min-height: ${height > 0 ? height : 100}px;
        width: ${width > 0 ? width + "px" : "100%"};
      `;
    }

    _setupHoverEffect() {
      // Disconnect previous handlers
      if (this._motionEventId) {
        this.disconnect(this._motionEventId);
        this._motionEventId = null;
      }
      if (this._leaveEventId) {
        this.disconnect(this._leaveEventId);
        this._leaveEventId = null;
      }

      this._hoverImages = [];

      if (!this._settings.get_boolean("hover-images-enabled")) return;

      const all = this._getImages();
      if (all.length < 2) return;

      this._hoverImages = all;

      // warm up the blurred fills so hover switching has no delay
      if (this._settings.get_string("fill-mode") === "image")
        all.forEach((p) => getBlurred(p, this._blurCb));

      // Connect motion event for hover tracking
      this._motionEventId = this.connect("motion-event", (actor, event) => {
        return this._onMotionEvent(actor, event);
      });

      // Reset to default image on leave
      this._leaveEventId = this.connect("leave-event", () => {
        this._currentImageIndex = 0;
        this._updateImage();
      });
    }

    _onMotionEvent(actor, event) {
      if (this._hoverImages.length === 0) {
        return Clutter.EVENT_PROPAGATE;
      }

      // Get mouse position relative to the banner
      const [x, y] = event.get_coords();
      const [actorX, actorY] = actor.get_transformed_position();
      const [width, height] = actor.get_size();

      // Calculate relative position (0 to 1)
      const relativeX = (x - actorX) / width;

      // Determine which image to show based on horizontal position
      const imageIndex = Math.floor(relativeX * this._hoverImages.length);
      const clampedIndex = Math.max(
        0,
        Math.min(imageIndex, this._hoverImages.length - 1),
      );

      // Only update if changed
      if (clampedIndex !== this._currentImageIndex) {
        this._currentImageIndex = clampedIndex;
        this._showHoverImage(this._hoverImages[clampedIndex]);
      }

      return Clutter.EVENT_PROPAGATE;
    }

    _showHoverImage(imagePath) {
      const file = Gio.File.new_for_path(imagePath);

      if (file.query_exists(null)) {
        this._currentPath = imagePath;
        this._applyFrameStyle();
        this._container.child = null;
        this._setStyle(this._container, this._buildStyle(imagePath));
      }
    }

    _updateImage() {
      const imagePath = this._getImages()[0];
      const ok =
        !!imagePath && Gio.File.new_for_path(imagePath).query_exists(null);

      this._currentPath = ok ? imagePath : null;
      this._applyFrameStyle();

      if (ok) {
        this._container.child = null;
        this._setStyle(this._container, this._buildStyle(imagePath));
        return;
      }

      this._showPlaceholder(imagePath);
    }

    // No image (or file missing): show our placeholder image.
    // Text only if the placeholder file itself is missing.
    _showPlaceholder(missingPath) {
      const ph = this._placeholderPath;

      if (ph && Gio.File.new_for_path(ph).query_exists(null)) {
        this._container.child = null;
        this._setStyle(this._container, this._buildStyle(ph));
        return;
      }

      this._container.style = "";
      this._container.child = new St.Label({
        text: missingPath
          ? "Image not found: " + missingPath
          : "No image. Add one in the extension preferences.",
        style_class: "image-placeholder",
      });
    }

    // Is the pointer in the invisible top-left corner of the banner?
    _inPrefsCorner() {
      const [px, py] = global.get_pointer();
      const [ax, ay] = this.get_transformed_position();
      const sf = St.ThemeContext.get_for_stage(global.stage).scale_factor;
      const size = PREFS_CORNER_SIZE * sf;
      return px >= ax && px <= ax + size && py >= ay && py <= ay + size;
    }

    _executeScript() {
      const scriptPath = this._settings.get_string("script-path");
      if (!scriptPath || scriptPath === "") {
        return;
      }

      try {
        GLib.spawn_command_line_async(scriptPath);
      } catch (e) {
        log(`Error executing script: ${e.message}`);
      }
    }

    destroy() {
      this._destroyed = true;
      if (this._motionEventId) {
        this.disconnect(this._motionEventId);
        this._motionEventId = null;
      }
      if (this._leaveEventId) {
        this.disconnect(this._leaveEventId);
        this._leaveEventId = null;
      }
      if (this._settingsChangedId) {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
      }
      super.destroy();
    }
  },
);

// Main extension class
export default class ImageQuickSettingsExtension extends Extension {
  enable() {
    this._settings = this.getSettings();

    getQuickSettings();

    this._origBoxStyle = QuickSettingsBox.style;
    this._addBanner();
    this._applyWidth();
    this._addStandalone();

    // Listen for settings changes
    // (image, colors, border, corners update live inside ImageBanner)
    this._settingsChangedIds = [
      this._settings.connect("changed::quick-settings-width", () =>
        this._applyWidth(),
      ),
      this._settings.connect("changed::position", () => {
        this._reload();
        this._applyWidth();
        this._addStandalone();
      }),
      this._settings.connect("changed::gap", () => this._reload()),
      this._settings.connect("changed::panel-button-icon", () =>
        this._addStandalone(),
      ),
      this._settings.connect("changed::panel-button-position", () =>
        this._addStandalone(),
      ),
      this._settings.connect("changed::standalone-gap", () =>
        this._positionFloating(),
      ),
    ];
  }

  _bannerOptions(standalone) {
    return {
      standalone,
      placeholderPath: `${this.path}/assets/placeholder.svg`,
      onOpenPrefs: () => this.openPreferences(),
    };
  }

  _applyWidth() {
    const standalone = this._settings.get_string("position") === "standalone";
    const w = standalone ? 0 : this._settings.get_int("quick-settings-width");
    QuickSettingsBox.style = w > 0 ? `width: ${w}px;` : this._origBoxStyle;
  }

  _addBanner() {
    // position values: top, bottom, top-detached, bottom-detached, standalone
    const mode = this._settings.get_string("position");
    if (mode === "standalone") return;

    const detached = mode.endsWith("-detached");
    const position = mode.startsWith("bottom") ? "bottom" : "top";
    const gap = this._settings.get_int("gap");

    // Create banner
    this._banner = new ImageBanner(this._settings, this._bannerOptions(false));

    // Store original style classes
    this._originalBoxStyle = QuickSettingsBox.style_class;
    this._originalActorStyle = QuickSettingsActor.style_class;

    if (detached) {
      // Detached mode: manipulate style classes like the reference extension
      QuickSettingsBox.style_class = "";
      QuickSettingsActor.style_class = " " + QuickSettingsActor.style_class;

      // Get the first child (the actual quick settings grid)
      const quickSettingsGrid = QuickSettingsBox.first_child;

      if (quickSettingsGrid) {
        // Store original grid style
        this._originalGridStyle = quickSettingsGrid.style_class;
        quickSettingsGrid.style_class =
          quickSettingsGrid.style_class + " popup-menu-content quick-settings";

        // Add banner based on position
        if (position === "top") {
          // Insert at the beginning
          QuickSettingsBox.insert_child_at_index(this._banner, 0);
          this._banner.style_class = "image-banner image-banner-detached";
          this._banner.setMargin(`margin-bottom: ${gap}px;`);
        } else {
          // Bottom: add banner after the grid
          QuickSettingsBox.add_child(this._banner);
          this._banner.style_class = "image-banner image-banner-detached";
          this._banner.setMargin(`margin-top: ${gap}px;`);
        }
      }
    } else {
      // Integrated mode: add directly to QuickSettingsBox (menu.box)
      // This places it as a real child in the vertical layout, not overlapping
      if (position === "top") {
        QuickSettingsBox.insert_child_at_index(this._banner, 0);
        this._banner.setMargin(`margin-bottom: ${gap}px;`);
      } else {
        QuickSettingsBox.add_child(this._banner);
        this._banner.setMargin(`margin-top: ${gap}px;`);
      }
    }
  }

  _reload() {
    this._removeBanner();
    this._addBanner();
  }

  _removeBanner() {
    if (this._banner) {
      const parent = this._banner.get_parent();
      if (parent) {
        parent.remove_child(this._banner);
      }
      this._banner.destroy();
      this._banner = null;
    }

    // Restore original styles
    if (this._originalBoxStyle) {
      QuickSettingsBox.style_class = this._originalBoxStyle;
      this._originalBoxStyle = null;
    }

    if (this._originalActorStyle) {
      QuickSettingsActor.style_class = this._originalActorStyle;
      this._originalActorStyle = null;
    }

    if (this._originalGridStyle) {
      const quickSettingsGrid = QuickSettingsBox.first_child;
      if (quickSettingsGrid) {
        quickSettingsGrid.style_class = this._originalGridStyle;
      }
      this._originalGridStyle = null;
    }
  }

  // ---- Standalone mode: panel button that opens the image on its own ----

  _addStandalone() {
    this._removeStandalone();
    if (this._settings.get_string("position") !== "standalone") return;

    const button = new PanelMenu.Button(0.0, "Panel Image Button", true);
    const iconStr = this._settings.get_string("panel-button-icon");
    const icon = new St.Icon({ style_class: "system-status-icon" });
    if (iconStr.startsWith("/")) icon.gicon = Gio.icon_new_for_string(iconStr);
    else icon.icon_name = iconStr || "image-x-generic-symbolic";
    button.add_child(icon);

    // PanelMenu.Button overrides the event vfunc, so hook "event" directly
    button.connect("event", (_actor, event) => {
      const type = event.type();
      if (
        type === Clutter.EventType.BUTTON_PRESS ||
        type === Clutter.EventType.TOUCH_BEGIN
      ) {
        this._toggleFloating();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });

    const side = this._settings.get_string("panel-button-position");
    Main.panel.addToStatusArea(`${this.uuid}-button`, button, 0, side);
    this._panelButton = button;

    this._floating = new ImageBanner(this._settings, this._bannerOptions(true));
    this._floating.hide();
    this._floating.connect("clicked", () => this._closeFloating());
    Main.layoutManager.addTopChrome(this._floating);
  }

  _toggleFloating() {
    if (!this._floating) return;

    if (this._floating.visible) {
      this._closeFloating();
      return;
    }

    this._floating.show();
    this._positionFloating();

    // Close on any click outside the image / panel button
    this._outsideId = global.stage.connect("captured-event", (_a, event) => {
      if (event.type() !== Clutter.EventType.BUTTON_PRESS)
        return Clutter.EVENT_PROPAGATE;
      const src = event.get_source();
      if (
        src &&
        !this._floating.contains(src) &&
        !this._panelButton.contains(src)
      )
        this._closeFloating();
      return Clutter.EVENT_PROPAGATE;
    });
  }

  _positionFloating() {
    if (!this._floating || !this._floating.visible || !this._panelButton)
      return;

    const monitor = Main.layoutManager.primaryMonitor;
    const gap = this._settings.get_int("standalone-gap");
    const [, w] = this._floating.get_preferred_width(-1);
    const [bx] = this._panelButton.get_transformed_position();
    const x = Math.max(monitor.x, Math.min(bx, monitor.x + monitor.width - w));
    this._floating.set_position(x, monitor.y + Main.panel.height + gap);
  }

  _closeFloating() {
    if (this._outsideId) {
      global.stage.disconnect(this._outsideId);
      this._outsideId = null;
    }
    if (this._floating) this._floating.hide();
  }

  _removeStandalone() {
    this._closeFloating();
    if (this._floating) {
      Main.layoutManager.removeChrome(this._floating);
      this._floating.destroy();
      this._floating = null;
    }
    if (this._panelButton) {
      this._panelButton.destroy();
      this._panelButton = null;
    }
  }

  disable() {
    if (this._settingsChangedIds) {
      this._settingsChangedIds.forEach((id) => this._settings.disconnect(id));
      this._settingsChangedIds = null;
    }
    QuickSettingsBox.style = this._origBoxStyle;
    this._removeStandalone();
    this._removeBanner();
    this._settings = null;
  }
}
