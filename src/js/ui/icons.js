// Icons: Lucide (ISC licence, https://lucide.dev), bundled at build time.
import play from 'lucide-static/icons/play.svg';
import pause from 'lucide-static/icons/pause.svg';
import skipBack from 'lucide-static/icons/skip-back.svg';
import skipForward from 'lucide-static/icons/skip-forward.svg';
import shuffle from 'lucide-static/icons/shuffle.svg';
import repeat from 'lucide-static/icons/repeat.svg';
import repeat1 from 'lucide-static/icons/repeat-1.svg';
import heart from 'lucide-static/icons/heart.svg';
import volume2 from 'lucide-static/icons/volume-2.svg';
import volume1 from 'lucide-static/icons/volume-1.svg';
import volumeX from 'lucide-static/icons/volume-x.svg';
import listMusic from 'lucide-static/icons/list-music.svg';
import micVocal from 'lucide-static/icons/mic-vocal.svg';
import maximize2 from 'lucide-static/icons/maximize-2.svg';
import minimize2 from 'lucide-static/icons/minimize-2.svg';
import chevronDown from 'lucide-static/icons/chevron-down.svg';
import chevronLeft from 'lucide-static/icons/chevron-left.svg';
import chevronRight from 'lucide-static/icons/chevron-right.svg';
import house from 'lucide-static/icons/house.svg';
import search from 'lucide-static/icons/search.svg';
import library from 'lucide-static/icons/library.svg';
import plus from 'lucide-static/icons/plus.svg';
import ellipsis from 'lucide-static/icons/ellipsis.svg';
import clock3 from 'lucide-static/icons/clock-3.svg';
import music from 'lucide-static/icons/music.svg';
import folder from 'lucide-static/icons/folder.svg';
import folderPlus from 'lucide-static/icons/folder-plus.svg';
import pin from 'lucide-static/icons/pin.svg';
import upload from 'lucide-static/icons/upload.svg';
import download from 'lucide-static/icons/download.svg';
import settings from 'lucide-static/icons/settings.svg';
import x from 'lucide-static/icons/x.svg';
import check from 'lucide-static/icons/check.svg';
import gripVertical from 'lucide-static/icons/grip-vertical.svg';
import moon from 'lucide-static/icons/moon.svg';
import list from 'lucide-static/icons/list.svg';
import layoutGrid from 'lucide-static/icons/layout-grid.svg';
import trash2 from 'lucide-static/icons/trash-2.svg';
import pencil from 'lucide-static/icons/pencil.svg';
import image from 'lucide-static/icons/image.svg';
import disc3 from 'lucide-static/icons/disc-3.svg';
import userRound from 'lucide-static/icons/user-round.svg';
import copy from 'lucide-static/icons/copy.svg';
import listPlus from 'lucide-static/icons/list-plus.svg';
import listStart from 'lucide-static/icons/list-start.svg';
import arrowUpDown from 'lucide-static/icons/arrow-up-down.svg';
import folderInput from 'lucide-static/icons/folder-input.svg';
import squarePlay from 'lucide-static/icons/square-play.svg';
import panelRightClose from 'lucide-static/icons/panel-right-close.svg';
import circlePlus from 'lucide-static/icons/circle-plus.svg';
import circleCheck from 'lucide-static/icons/circle-check.svg';
import clipboardPaste from 'lucide-static/icons/clipboard-paste.svg';
const SVG = {
  'square-play': squarePlay,
  'panel-right-close': panelRightClose,
  'circle-plus': circlePlus,
  'circle-check': circleCheck,
  'clipboard-paste': clipboardPaste,
  'play': play,
  'pause': pause,
  'skip-back': skipBack,
  'skip-forward': skipForward,
  'shuffle': shuffle,
  'repeat': repeat,
  'repeat-1': repeat1,
  'heart': heart,
  'volume-2': volume2,
  'volume-1': volume1,
  'volume-x': volumeX,
  'list-music': listMusic,
  'mic-vocal': micVocal,
  'maximize-2': maximize2,
  'minimize-2': minimize2,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  'house': house,
  'search': search,
  'library': library,
  'plus': plus,
  'ellipsis': ellipsis,
  'clock-3': clock3,
  'music': music,
  'folder': folder,
  'folder-plus': folderPlus,
  'pin': pin,
  'upload': upload,
  'download': download,
  'settings': settings,
  'x': x,
  'check': check,
  'grip-vertical': gripVertical,
  'moon': moon,
  'list': list,
  'layout-grid': layoutGrid,
  'trash-2': trash2,
  'pencil': pencil,
  'image': image,
  'disc-3': disc3,
  'user-round': userRound,
  'copy': copy,
  'list-plus': listPlus,
  'list-start': listStart,
  'arrow-up-down': arrowUpDown,
  'folder-input': folderInput,
};
const cache = new Map();
/** Inline SVG markup for an icon. */
export function ic(name, cls = '') {
  const key = `${name}|${cls}`;
  if (!cache.has(key)) {
    const svg = SVG[name].replace(/<!--.*?-->/s, '').replace(/\s+/g, ' ').trim()
      .replace(/class="[^"]*"/, `class="ic ic-${name} ${cls}" aria-hidden="true"`).replace(/ width="24" height="24"/, '');
    cache.set(key, svg);
  }
  return cache.get(key);
}
