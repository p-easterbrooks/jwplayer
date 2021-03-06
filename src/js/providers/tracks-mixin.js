define(['../utils/underscore',
        '../utils/id3Parser',
        '../utils/helpers',
        '../utils/dom'
], function(_, ID3Parser, utils, dom) {
    /**
     * Used across caterpillar, html5 and dash providers for handling text tracks actions and events
     */
    var Tracks = {
        addTracksListener: addTracksListener,
        clearTracks: clearTracks,
        disableTextTrack: disableTextTrack,
        getSubtitlesTrack: getSubtitlesTrack,
        removeTracksListener: removeTracksListener,
        setTextTracks: setTextTracks,
        setupSideloadedTracks: setupSideloadedTracks,
        setSubtitlesTrack: setSubtitlesTrack,
        textTrackChangeHandler: textTrackChangeHandler
    };

    var _textTracks = null, // subtitles and captions tracks
        _textTracksCache = null,
        _currentTextTrackIndex = -1, // captionsIndex - 1 (accounts for Off = 0 in model)
        _nativeTrackCount = 0; // Need to know the number of tracks added to the browser. May differ from total count

    function _cueChangeHandler(e) {
        var activeCues = e.currentTarget.activeCues;
        if (!activeCues || !activeCues.length) {
            return;
        }

        // Get the most recent start time. Cues are sorted by start time in ascending order by the browser
        var startTime = activeCues[activeCues.length - 1].startTime;

        var dataCues = [];

        _.each(activeCues, function(cue) {
            if (cue.startTime < startTime) {
                return;
            }
            if (cue.data) {
                dataCues.push(cue);
            } else if (cue.text) {
                this.trigger('meta', {
                    metadataTime: startTime,
                    metadata: JSON.parse(cue.text)
                });
            }
        }, this);

        if (dataCues.length) {
            var id3Data = ID3Parser.parseID3(dataCues);
            this.trigger('meta', {
                metadataTime: startTime,
                metadata: id3Data
            });
        }
    }

    function setTextTracks() {
        var tracks = this.video.textTracks;
        _currentTextTrackIndex = -1;
        if (!tracks) {
            return;
        }

        if (!_textTracks) {
            _initTextTracks();
        }

        //filter for 'subtitles' or 'captions' tracks
        if (tracks.length) {
            var i = 0, len = tracks.length;

            for (i; i < len; i++) {
                var track = tracks[i];
                if (_textTracksCache[i + track.kind]) {
                    continue;
                }
                if (track.kind === 'metadata') {
                    track.oncuechange = _cueChangeHandler.bind(this);
                    track.mode = 'showing';
                    _textTracksCache[i + track.kind] = track;
                }
                else if (track.kind === 'subtitles' || track.kind === 'captions') {
                    _textTracks.push(track);
                    _textTracksCache[i + track.kind] = track;
                }
            }
        }
        this.addTracksListener(_textTracks, 'change', textTrackChangeHandler);
        if (_textTracks && _textTracks.length) {
            this.trigger('subtitlesTracks', {tracks: _textTracks});
        }
    }

    function setupSideloadedTracks(tracks) {
        var canRenderNatively = utils.isChrome() || utils.isIOS() || utils.isSafari();
        if (this._isSDK || !canRenderNatively || !tracks || !tracks.length) {
            return;
        }
        // Add tracks if we're starting playback or resuming after a midroll
        if (!_tracksAlreadySideloaded(tracks)) {
            disableTextTrack();
            dom.emptyElement(this.video);
            _addTracks.call(this, tracks);
        }
    }

    function _tracksAlreadySideloaded(tracks) {
        // Determines if tracks have already been added to the video element or
        // just to the _textTracks list for rendering with the captions renderer
        return tracks && _textTracks && tracks.length === _textTracks.length &&
            this.video.textTracks.length === _nativeTrackCount;
    }

    function _addTracks(tracks) {
        _nativeTrackCount = 0;
        // Adding .vtt tracks to the DOM lets the tracks API handle CC/Subtitle rendering
        if (!tracks) {
            return;
        }
        var crossoriginAnonymous = false;
        if(!_textTracks) {
            _initTextTracks();
        }
        for (var i = 0; i < tracks.length; i++) {
            var itemTrack = tracks[i];
            // only add .vtt or .webvtt files
            if(!(/\.(?:web)?vtt(?:\?.*)?$/i).test(itemTrack.file)) {
                // non-VTT tracks need to be added here so they can be displayed using the captions renderer
                _textTracks.push(itemTrack);
                _textTracksCache[i + itemTrack.kind] = track;
                continue;
            }
            // only add valid kinds https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track
            if (!(/subtitles|captions|descriptions|chapters|metadata/i).test(itemTrack.kind)) {
                continue;
            }
            if (!crossoriginAnonymous) {
                // CORS applies to track loading and requires the crossorigin attribute
                if (!this.video.hasAttribute('crossorigin') && utils.crossdomain(itemTrack.file)) {
                    this.video.setAttribute('crossorigin', 'anonymous');
                    crossoriginAnonymous = true;
                }
            }
            var track = document.createElement('track');
            track.src     = itemTrack.file;
            track.kind    = itemTrack.kind;
            track.srclang = itemTrack.language || '';
            track.label   = itemTrack.label;
            track.mode    = 'disabled';
            track.id = itemTrack.default || itemTrack.defaulttrack ? 'default' : '';

            // add vtt tracks directly to the video element
            this.video.appendChild(track);
            _nativeTrackCount++;
        }
    }

    function _initTextTracks() {
        _textTracks = [];
        _textTracksCache = {};
    }

    function setSubtitlesTrack (index) {
        if (!_textTracks) {
            return;
        }

        // _currentTextTrackIndex = index - 1 ('Off' = 0 in controlbar)
        if(_currentTextTrackIndex === index - 1) {
            return;
        }

        // Disable all tracks
        _.each(_textTracks, function (track) {
            track.mode = 'disabled';
        });

        // Set the provider's index to the model's index, then show the selected track if it exists
        _currentTextTrackIndex = index - 1;
        if (_textTracks[_currentTextTrackIndex]) {
            _textTracks[_currentTextTrackIndex].mode = 'showing';
        }

        // update the model index if change did not originate from controlbar or api
        this.trigger('subtitlesTrackChanged', {
            currentTrack: _currentTextTrackIndex + 1,
            tracks: _textTracks
        });
    }

    function getSubtitlesTrack() {
        return _currentTextTrackIndex;
    }

    function addTracksListener (tracks, eventType, handler) {
        handler.bind(this);

        if (tracks.addEventListener) {
            tracks.addEventListener(eventType, handler);
        } else {
            tracks['on' + eventType] = handler;
        }
    }

    function removeTracksListener (tracks, eventType, handler) {
        if (!tracks) {
            return;
        }
        if (tracks.removeEventListener) {
            tracks.removeEventListener(eventType, handler);
        } else {
            tracks['on' + eventType] = null;
        }
    }

    function textTrackChangeHandler () {

        if (!_textTracks) {
            //if tracks/cues are first added after the loadeddata event...
            this.setTextTracks();
        } else {
            // if a caption/subtitle track is showing, find its index
            var _selectedTextTrackIndex = -1, i = 0;
            for (i; i < _textTracks.length; i++) {
                if (_textTracks[i].mode === 'showing') {
                    _selectedTextTrackIndex = i;
                    break;
                }
            }
            this.setSubtitlesTrack(_selectedTextTrackIndex + 1);
        }
    }

    function clearTracks() {
        _textTracks = null;
        _textTracksCache = null;
    }

    function disableTextTrack() {
        if (_textTracks && _textTracks[_currentTextTrackIndex]) {
            _textTracks[_currentTextTrackIndex].mode = 'disabled';
        }
    }

    return Tracks;
});