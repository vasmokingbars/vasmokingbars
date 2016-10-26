/**
 * Utility functions and objects
 */

/**
 * Calls back the given function with a google.maps.LatLng indicating the
 * client's location, augmented with city and state fields. If this cannot find
 * the user's location with either method, it uses a default location in
 * Northern Virginia.
 */
function clientLocationLookup(callback) {

	var clientLocationByIp = function() {
		var locator = google.loader.ClientLocation;
		if (!locator) {
			locator = {
				latitude : 38.8872209,
				longitude : -77.1919999,
				address : {
					city : 'Falls Church',
					region : 'VA'
				}
			};
		}

		var result = new google.maps.LatLng(locator.latitude, locator.longitude);
		result.city = locator.address.city;
		result.state = locator.address.region;
		return result;
	};

	try {
		if (!document.cookie) {
			callback(clientLocationByIp());
			return;
		}

		var storedLocation = null;
		document.cookie.split('; ').each(function(rawCookie) {
			var cookie = rawCookie.split('=');
			if (cookie[0] === 'lastLocation') {
				storedLocation = unescape(cookie[1]);
				geocode(unescape(cookie[1]), callback);
			}
		});

		if (!storedLocation) {
			callback(clientLocationByIp());
		}
	} catch (error) {
		postError(error);
		callback(null);
	}
}

/**
 * Calls back the callback with a google.maps.Directions on success, null
 * otherwise.
 */
function distanceByDriving(place1, place2, callback) {

	var pointForVar = function(place) {
		var result = {};
		if (typeof place.lat === 'function') {
			result.lat = parseFloat(place.lat());
			result.lng = parseFloat(place.lng());
		} else {
			result.lat = parseFloat(place.lat);
			result.lng = parseFloat(place.lng);
		}
		return result;
	};

	var lat1 = pointForVar(place1).lat;
	var lng1 = pointForVar(place1).lng;
	var lat2 = pointForVar(place2).lat;
	var lng2 = pointForVar(place2).lng;

	var directions = new google.maps.Directions();
	var lookupString = '(' + lat1 + ',' + lng1 + ') to (' + lat2 + ',' + lng2
			+ ')';

	var errorHandler = function() {
		removeListeners();
		postError( {
			message : 'Directions lookup failed',
			googleStatus : directions.getStatus(),
			lookupString : lookupString
		});
		callback(null);
	};

	var removeListeners = function() {
		google.maps.event.removeListener(errorListenerHandle);
		google.maps.event.removeListener(successListenerHandle);
		callback(null);
	};

	var successHandler = function() {
		removeListeners();
		callback(directions);
	};

	var errorListenerHandle = google.maps.event.addListener(directions,
			'error', errorHandler);
	var successListenerHandle = google.maps.event.addListener(directions,
			'load', successHandler);
	directions.load(lookupString, {
		getPolyline : true
	});
}

/**
 * Passes a google.maps.LatLng to the callback function if geocoding succeed.
 * Calls back with null if geocoding fails, or the result is not precise to the
 * "town" level.
 * 
 * The LatLng result will be augmented with these fields: street (may be
 * undefined), city, state, zip, precision (0-9, see Google docs).
 * 
 */
function geocode(address, callback) {
	if (!address) {
		return callback(null);
	}

	var handleGeocodedResponse = function(response, status) {
		if (!response || status !== google.maps.GeocoderStatus.OK) {
			postError({
				message: 'Geocoding failed',
				status: status,
				search: address
			});
			callback(null);
			return;
		}

		var placemark = response.Placemark[0];
		var lat = placemark.Point.coordinates[1];
		var lng = placemark.Point.coordinates[0];
		var result = new google.maps.LatLng(lat, lng);

		result.precision = placemark.AddressDetails.Accuracy;
		if (result.precision < 4) {
			// 4 is town-level precision
			callback(null);
			return;
		}

		var country = placemark.AddressDetails.Country.CountryName;
		if (country !== 'USA' && country !== 'Canada') {
			// Try putting 'hey ho' into the search to trigger this
			// I do not know how to handle international addresses, so I
			// just ignore them for now
			
			callback(null);
			return;
		}

		result.state = placemark.AddressDetails.Country.AdministrativeArea.AdministrativeAreaName;

		var locality = null;
		if (placemark.AddressDetails.Country.AdministrativeArea.SubAdministrativeArea) {
			locality = placemark.AddressDetails.Country.AdministrativeArea.SubAdministrativeArea.Locality;
		} else {
			// I did not see this specified in the Google docs, but I managed to
			// get a result where Locality was a child of AdministrativeArea on
			// a search for '5113 Leesburg Pike, Falls Church, VA'
			
			locality = placemark.AddressDetails.Country.AdministrativeArea.Locality;
		}
		result.city = locality.LocalityName;

		if (locality.DependentLocality) {
			// I did not see this specified in the Google docs, but I got a result
			// like this when searching for '32 Watts St, New York, NY'
			
			locality = locality.DependentLocality;
		}
		
		if (locality.Thoroughfare) {
			result.street = locality.Thoroughfare.ThoroughfareName;
		}

		if (locality.PostalCode) {
			result.zip = locality.PostalCode.PostalCodeNumber;
		}

		callback(result);
	};
	
	var geocoder = new google.maps.Geocoder();
	geocoder.geocode({address: address}, function(response, status) {
		try {
			handleGeocodedResponse(response, status);
		} catch (error) {
			error.query = address;
			postError(error);
			callback(null);
		}
	});
}

var page = {};

/**
 * Puts a Google map in the mapCanvas div. Returns the map. You must then set
 * the center and the zoom. If truthy, the optional hideControls parameter will
 * hide the zoom controls and such, making a clean map.
 */
page.createMap = function(hideControls) {
	var result = new google.maps.Map(document.getElementById('mapCanvas'), {
		mapTypeId: google.maps.MapTypeId.ROADMAP
	});
	/*
	var settings = result.getDefaultUI();
	settings.maptypes.satellite = false;
	settings.maptypes.hybrid = false;
	settings.maptypes.physical = false;
	settings.controls.scalecontrol = false;
	settings.controls.maptypecontrol = false;
	settings.controls.menumaptypecontrol = false;

	if (hideControls) {
		settings.controls.largemapcontrol3d = false;
		settings.controls.smallzoomcontrol3d = false;
	}

	result.setUI(settings);
	*/
	return result;
};

/**
 * @return an object containing the query parameters from this page's URL
 */
page.params = function() {
	var rawParams = window.location.href.toQueryParams();

	var result = {};
	for (param in rawParams) {
		if (rawParams.hasOwnProperty(param)) {
			if (rawParams[param]) {
				// TODO: this fails on no parameters without the if check, why?
				result[param] = rawParams[param].replace(/\+/g, ' ');
			}
		}
	}
	return result;
};

page.searchResults = {

	createResult : function() {
		var container = $('searchResults');
		return {
			// All these fields must be escaped before setting them
			name : null,
			street : null, // Including number
			city : null, // Or town, or whatever
			link : null, // String, optional
			glyph : null, // optional

			/**
			 * Renders its properties as DOM nodes, which it appends to the
			 * searchResults node in the page.
			 *  
			 * On click, this will call setSelectedResult, passing it the
			 * onclickParam.
			 * 
			 * @return the 'searchResult' div element
			 */
			render : function(onclickParam) {
				/*-
				 * Format:
				 * <div class="searchResult" onclick="setSelectedResult(0)">
				 * 	<img class="placeGlyph"/>
				 * 	<p class="placeInfo">
				 * 		<div class="placeName">Foo Bar</div>
				 * 		<div class="placeAddress">123 Bar St, Fooburg</div>
				 * 		<a class="placeLink">Link</a>
				 * 	</p>
				 * </div>
				 */
			
				var container = $('searchResults');
				var index = $$('.searchResult').length;

				var result = document.createElement('div');
				result.className = 'searchResult';
				result.onclick = function () {
					setSelectedResult(onclickParam);
				};
				container.appendChild(result);

				if (this.glyph) {
					var placeGlyph = document.createElement('img');
					placeGlyph.src = this.glyph;
					placeGlyph.className = 'placeGlyph';
					result.appendChild(placeGlyph);
				}

				var placeInfo = document.createElement('p');
				placeInfo.className = 'placeInfo';
				result.appendChild(placeInfo);

				var placeName = document.createElement('div');
				placeName.className = 'placeName';
				placeName.innerHTML = this.name.escapeHTML();
				placeInfo.appendChild(placeName);

				if (this.link) {
					var placeLink = document.createElement('a');
					placeLink.href = this.link;
					placeLink.className = 'placeLink';
					placeLink.innerHTML = 'Link';
					placeInfo.appendChild(placeLink);
				}

				var placeAddress = document.createElement('div');
				placeAddress.className = 'placeAddress';
				placeAddress.innerHTML = this.street.escapeHTML() + ', ' + this.city.escapeHTML();
				placeInfo.appendChild(placeAddress);

				return result;
			}
		};
	},

	erase : function() {
		var container = $('searchResults');
		while (container.hasChildNodes()) {
			container.removeChild(container.firstChild);
		}
	},

	/**
	 * The given place must have a 'node' field that is the DOM element that
	 * holds the search listing on the page. This removes the the previously
	 * selected node's ID and sets the given node's ID appropriately.
	 */
	setSelected : function(place) {
		// TODO: how does this somehow get called with an undefined place parameter
		// from the search page, when clicking on a marker?
		if (this.selected) {
			this.selected.node.id = null;
		}
		this.selected = place;
		if (this.selected) {
			this.selected.node.id = 'selectedResult';
		}
	}
};

/**
 * Store the given value in the 'lastLocation' cookie. The value should have
 * either lat and lng fields or methods. Returns true on success, and false if
 * cookies are disabled.
 * 
 * Throws a message if passed an object without lat and lng set.
 */
page.storeLastLocation = function(location) {

	var lat = (typeof location.lat === 'function') ? location.lat()
			: location.lat;
	var lng = (typeof location.lng === 'function') ? location.lng()
			: location.lng;

	if (!lat || !lng) {
		throw 'Tried to store a location without a lat/lng';
	}

	var expires = new Date();
	// A long time from now
	expires.setTime(expires.getTime() + 365 * 24 * 60 * 60 * 1000);
	document.cookie = 'lastLocation=' + escape(lat + ', ' + lng) + ';Expires='
			+ expires.toUTCString();

	if (!document.cookie) {
		return false;
	}
	return true;
};

function postError(error) {
	new Ajax.Request('errors.php', {
		parameters : {
			// Can't just jam everything in a POST body because
			// PHP does not accept it
			url : window.location.href,
			exception : Object.toJSON(error)
		}
	});
}
