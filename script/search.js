/**
 * Plots places on a map for the Smoking Bars site
 */

var map = null;

/*-
 * Each search result is a google.maps.LatLng plus these properties
 * 
 *   barname
 *   street
 *   city
 *   state
 *   phone - optional
 *   
 *   directions(callback) - a method that lazily loads directions from userLocation,
 *     calling the callback with a google.maps.Directions when complete 
 */
var searchResults = [];
var displayResultsRange = {
	len: 10,
	min : 0,
	max : 9,
	decrement : function () {
		this.min = Math.max(0, this.min - this.len);
		this.max = Math.max(len - 1, this.max - this.len);
	},
	increment : function () {
		this.min += this.len;
		this.max += this.len;
	},
	size : function () {
		return this.max - this.min + 1;
	},
	setTarget : function (index) {
		this.min = Math.floor(index / this.len) * this.len;
		this.max = this.min + this.len - 1;
	}
};

/**
 * A google.maps.LatLng, augmented with properties from my geocode function, an icon
 * and a map marker.
 */
var userLocation = null;

function initialize() {
	var query = page.params().query;
	new Ajax.Request('record-search.php', {
		parameters : {
			query : query
		}
	});
	
	// Do not count on this setting the state, it is asyncronous
	lookupUserAddress(query);
	$('searchInput').focus();
}
window.onload = initialize

/**
 * Geocodes the supplied query, looks up nearby bars from the server, and draws
 * everything on a map.
 */
function lookupUserAddress(place) {

	var continueSearch = function(queryLocation) {
		if (queryLocation) {
			finishSearch(queryLocation);
		} else {
			clientLocationLookup(function(lookupLocation) {
				finishSearch(lookupLocation);
			});
		}
	};

	var finishSearch = function(location) {
		if (!location) {
			createMap();
			return;
		}

		userLocation = location;
		page.storeLastLocation(userLocation);
		userLocation.addressText = userLocation.city + ', '
			+ userLocation.state;
		userLocation.icon = G_DEFAULT_ICON;
		userLocation.marker = new google.maps.Marker(userLocation, {
			icon : userLocation.icon,
			clickable : false
		});
		writeUserAddress();
		lookupBars();
	};

	var writeUserAddress = function() {
		var text = document.getElementById('userAddressText');
		text.innerHTML = userLocation.addressText.escapeHTML();
		var icon = document.createElement('img');
		icon.src = userLocation.icon.image;
		icon.className = 'placeGlyph';
		$('userAddressInfo').insertBefore(icon, text);
	};

	if (!place) {
		continueSearch();
		return;
	}

	geocode(place, function(location) {
		if (!location) {
			alert("Can't find that spot");
		}
		continueSearch(location);
	});
}

function lookupBars() {
	var loadSearchResults = function(response) {
		var rawSearchResults = response.responseText.evalJSON();
		rawSearchResults.each (function (rawSearchResult) {
			var searchResult = new google.maps.LatLng(rawSearchResult.lat, rawSearchResult.lng);
			for (property in rawSearchResult) {
				if (rawSearchResult.hasOwnProperty(property)) {
					if (property !== 'lat' && property !== 'lng') {
						searchResult[property] = rawSearchResult[property];
					}
				}
			}
			searchResults.push(searchResult);
		});

		searchResults = searchResults.sortBy(function(place) {
			var result = place.distanceFrom(userLocation);
			result = place.indoor_smoking ? result - 1000000 : result;
			return result;
		});

		searchResults.each(function(place, index) {
			
			// Attach the pushpin icon with the appropriate number
			place.icon = resultIcon(place, index);
		
			// Attach the directions function for looking up driving distance
			var cachedDirections = null;
			place.directions = function(callback) {
				if (cachedDirections) {
					callback(cachedDirections);
				} else {
					distanceByDriving(userLocation, place, function(
							directionsResult) {
						cachedDirections = directionsResult;
						callback(cachedDirections);
					});
				}
			};

			// Attach a map marker
			point = new google.maps.LatLng(place.lat(), place.lng());
			var marker = new google.maps.Marker(point, place.icon);
			marker.place = place;
			place.marker = marker;
		});

		var targetSearchResult = setTargetSearchResultsPage();
		createMap();
		renderSearchResults(targetSearchResult);
	};

	var resultIcon = function(place, index) {
		var result = new google.maps.Icon(G_DEFAULT_ICON);
		var color = '0BB5FF';
		if (place.indoor_smoking) {
			color = '00FF00';
		}
		result.image = 'http://chart.apis.google.com/chart?chst=d_map_pin_letter&chld='
				+ (index + 1) + '|' + color + '|000000';
		return result;
	};

	new Ajax.Request('./bars.php', {
		method : 'get',
		onSuccess : loadSearchResults,
		parameters : {
			lat : userLocation.lat(),
			lng : userLocation.lng()
		}
	});
}

/**
 * If userLocation and searchResults are defined, will plot them. Otherwise,
 * just draws a default map.
 */
function createMap() {

	map = page.createMap();
	scaleMapToResults();

	google.maps.event.addListener(map, 'click', function(overlay) {
		if (overlay instanceof google.maps.Marker) {
			if (overlay.place) {
				setSelectedResult(overlay.place);
			}
		}
	});
	
	google.maps.event.addListener(map, 'infowindowclose', function() {
		// For some crazy reason, the Google maps API does not have a way
		// to check whether the info window is open or not
		map.infoWindowIsOpen = false;
	});
}

function renderSearchResults(selected) {
	page.searchResults.erase();

	if (searchResults.length === 0) {
		$('searchResults').innerHTML = 'No results<br><a href="add.html">Add a bar</a>';
		return;
	}

	if (displayResultsRange.min > 0) {
		$('priorPageLink').style.visibility = 'visible';
	} else {
		$('priorPageLink').style.visibility = 'hidden';
	}
	if (displayResultsRange.max < searchResults.length - 1) {
		$('nextPageLink').style.visibility = 'visible';
	} else {
		$('nextPageLink').style.visibility = 'hidden';
	}
	if (searchResults.length > displayResultsRange.size()) {
		$('searchResultsPageControl').style.display = 'block';
	}
	
	$('lowResult').innerHTML = displayResultsRange.min + 1;
	$('highResult').innerHTML = Math.min(displayResultsRange.max + 1, searchResults.length);
	$('totalResults').innerHTML = searchResults.length;
	map.clearOverlays();
	map.addOverlay(userLocation.marker);
	scaleMapToResults();

	searchResults.each(function(place, index) {

		if (index < displayResultsRange.min
				|| index > displayResultsRange.max) {
			return;
		}

		var node = page.searchResults.createResult();
		node.name = place.barname;
		node.street = place.street;
		node.city = place.city;
		node.glyph = place.icon.image;

		place.node = node.render(place);
		map.addOverlay(place.marker);
	});
	
	if (selected) {
		setSelectedResult(selected);
	} else if (searchResults.length > 0) {
		setSelectedResult(searchResults[displayResultsRange.min]);
	}
}

function resultsPageBack() {
	displayResultsRange.decrement();
	renderSearchResults();
}

function resultsPageForward() {
	displayResultsRange.increment();
	renderSearchResults();
}

function scaleMapToResults() {
	var bounds = searchResultsBounds();
	var center = userLocation ?
			userLocation :
			new google.maps.LatLng(38.882334, -77.171091); // Falls Church, VA
	var zoom = 10;
	if (bounds) {
		center = bounds.getCenter();
		
		// Zoom level is just a bit less than required to show all results. I do
		// this because the map skews when the selected result is on the very
		// edge.
		zoom = map.getBoundsZoomLevel(bounds) - 1;
	}
	map.setCenter(center, zoom);
}

/**
 * If search results are available, calculates the bounds that cover them all.
 * Returns null if user location is not defined or search results are empty.
 */
function searchResultsBounds() {
	if (!userLocation || !searchResults || searchResults.length === 0) {
		return null;
	}

	var lowLat = userLocation.lat();
	var lowLng = userLocation.lng();
	var highLat = userLocation.lat();
	var highLng = userLocation.lng();
	
	searchResults.each(function(place, index) {
		if (index < displayResultsRange.min || index > displayResultsRange.max) {
			return;
		}
		lowLat = Math.min(lowLat, place.lat());
		lowLng = Math.min(lowLng, place.lng());
		highLat = Math.max(highLat, place.lat());
		highLng = Math.max(highLng, place.lng());
	});

	var low = new google.maps.LatLng(lowLat, lowLng);
	var high = new google.maps.LatLng(highLat, highLng);
	return new google.maps.LatLngBounds(low, high);
}

function setSelectedResult(place) {
	
	/*-
	 * Result looks like this:
	 * 
	 * <div class="popupInfo">
	 * 	<div class="placeName">
	 * 		<!-- Anchor tag not present if server did not provide an URL --> 
	 * 		<a href="bar_url">Bar name</a>
	 * 	</div>
	 * 	<!-- Optional -->
	 * 	<div class="placePhone">(123) 456-7890</div>
	 * 	<div class="popupInfoFooter">
	 * 		<!-- Says "Outdoor smoking only" if smoking style is not indoors -->
	 * 		<span class="smokingStyle">Indoor smoking</span>
	 * 		<a href="./directions.html?...">Directions</a>
	 * 		<!-- Optional -->
	 * 		<span class="smokingRestriction">Restrictions on smoking</span>
	 * 	</div>
	 * </div>
	 */
	var popupWindowNode = function () {
		
		var barNameNode = document.createElement('div');
		barNameNode.className = 'placeName';
		if (place.url) {
			var barLinkNode = document.createElement('a');
			barLinkNode.href = place.url;
			barLinkNode.innerHTML = place.barname.escapeHTML();
			barNameNode.appendChild(barLinkNode);
		} else {
			barNameNode.innerHTML = place.barname.escapeHTML();
		}
		
		if (place.phone) {
			var barPhoneNode = document.createElement('div');
			barPhoneNode.className = 'placePhone';
			barPhoneNode.innerHTML = place.phone.escapeHTML();
		}
		
		var smokingStyleNode = document.createElement('span');
		smokingStyleNode.className = 'smokingStyle';
		smokingStyleNode.innerHTML = place.indoor_smoking ? 'Indoor smoking' : 'Outdoor smoking only';
		
		if (place.restrictions) {
			var restrictionsNode = document.createElement('span');
			restrictionsNode.className = 'smokingRestriction';
			restrictionsNode.innerHTML = place.restrictions.escapeHTML();
		}
		
		var directionsLinkNode = document.createElement('a');
		directionsLinkNode.href = './directions.html?' + Object
			.toQueryString( {
				fromLat : userLocation.lat(),
				fromLng : userLocation.lng(),
				from : userLocation.addressText,
				barName : place.barname,
				barAddress : place.street + ', ' + place.city,
				barPhone : place.phone,
				barLat : place.lat(),
				barLng : place.lng()
			});
		directionsLinkNode.innerHTML = 'Directions';
		
		var popupFooterNode = document.createElement('div');
		popupFooterNode.className = 'popupInfoFooter';
		popupFooterNode.appendChild(smokingStyleNode);
		popupFooterNode.appendChild(directionsLinkNode);
		if (restrictionsNode) {
			popupFooterNode.appendChild(restrictionsNode);
		}
		
		var popupInfo = document.createElement('div');
		popupInfo.className = 'popupInfo';
		popupInfo.appendChild(barNameNode);
		if (barPhoneNode) {
			popupInfo.appendChild(barPhoneNode);
		}
		popupInfo.appendChild(popupFooterNode);
		
		return popupInfo;
	};
	
	var showDirectionsLine = function () {
		page.searchResults.selected.directions(function(directions) {
			if (directions) {
				// If the directions lookup fails, just ignore the error, continue without
				// a line on the map
				
				if (page.searchResults.selected === place) {
					// If the user clicks through the results fast enough that getting
					// directions does not return before the user selects a different
					// result, we do not want to see both lines.
					
					map.addOverlay(directions.getPolyline());
				}
			}
		});
	};
	
	var showInfoWindow = function () {
		place.marker.openInfoWindow(popupWindowNode());
		map.infoWindowIsOpen = true;
	};
	
	if (page.searchResults.selected) {
		if (page.searchResults.selected === place) {
			// Short circuit stops the map from blinking when clicking
			// on an already selected result
			
			if (map.infoWindowIsOpen) {
				return;
			}
			showInfoWindow();
			return;
		}
		page.searchResults.selected.directions(function(directions) {
			if (directions) {
				map.removeOverlay(directions.getPolyline());
			}
		});
	}
	page.searchResults.setSelected(place);
	showDirectionsLine();
	showInfoWindow();
}

function setTargetSearchResultsPage() {
	var targetBarId = page.params().select;
	if (!targetBarId) {
		return null;
	}
	var targetIndex;
	for (var i = 0; i < searchResults.length; i++) {
		if (searchResults[i].barid === targetBarId) {
			targetIndex = i;
		}
	}
	if (!targetIndex) {
		return null;
	}
	displayResultsRange.setTarget(targetIndex);
	return searchResults[targetIndex];
}
