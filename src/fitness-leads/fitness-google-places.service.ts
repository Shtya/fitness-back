import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { FITNESS_NEARBY_TYPES } from './fitness-leads.config';
import { sleep } from './fitness-leads.utils';

const PLACE_FIELDS =
	'places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.addressComponents,places.websiteUri,places.internationalPhoneNumber,places.nationalPhoneNumber,places.googleMapsUri';
const TEXT_MASK = `${PLACE_FIELDS},nextPageToken`;
const NEARBY_MASK = PLACE_FIELDS;

@Injectable()
export class FitnessGooglePlacesService {
	private readonly logger = new Logger(FitnessGooglePlacesService.name);

	async textSearch(apiKey: string, query: string, countryCode: string, maxPages = 2) {
		const all: any[] = [];
		let pageToken: string | null = null;
		for (let page = 1; page <= maxPages; page++) {
			try {
				const body: any = {
					textQuery: query,
					regionCode: countryCode,
					maxResultCount: 20,
				};
				if (pageToken) body.pageToken = pageToken;
				const { data } = await axios.post(
					'https://places.googleapis.com/v1/places:searchText',
					body,
					{
						headers: {
							'Content-Type': 'application/json',
							'X-Goog-Api-Key': apiKey,
							'X-Goog-FieldMask': TEXT_MASK,
						},
						timeout: 25000,
					},
				);
				const places = (data.places || []).map((p: any) => ({ ...p, _source: 'google_text' }));
				all.push(...places);
				pageToken = data.nextPageToken || null;
				if (!pageToken || !places.length) break;
				await sleep(1500);
			} catch (error: any) {
				this.logger.warn(`Text search failed [${query}]: ${error?.message || error}`);
				break;
			}
		}
		return all;
	}

	async nearbySearch(apiKey: string, lat: number, lng: number, radius = 3500) {
		try {
			const { data } = await axios.post(
				'https://places.googleapis.com/v1/places:searchNearby',
				{
					includedTypes: FITNESS_NEARBY_TYPES,
					maxResultCount: 20,
					locationRestriction: {
						circle: {
							center: { latitude: lat, longitude: lng },
							radius,
						},
					},
				},
				{
					headers: {
						'Content-Type': 'application/json',
						'X-Goog-Api-Key': apiKey,
						'X-Goog-FieldMask': NEARBY_MASK,
					},
					timeout: 25000,
				},
			);
			return (data.places || []).map((p: any) => ({ ...p, _source: 'google_nearby' }));
		} catch (error: any) {
			this.logger.warn(`Nearby search failed: ${error?.message || error}`);
			return [];
		}
	}

	async nearbyGridSearch(apiKey: string, lat: number, lng: number, gridSize = 3, stepKm = 4) {
		const points = this.gridPoints(lat, lng, gridSize, stepKm);
		const all: any[] = [];
		for (const p of points) {
			const batch = await this.nearbySearch(apiKey, p.lat, p.lng);
			all.push(...batch);
			await sleep(800);
		}
		return all;
	}

	private gridPoints(centerLat: number, centerLng: number, gridSize: number, stepKm: number) {
		const points: { lat: number; lng: number }[] = [];
		const kmPerDegLat = 111;
		const kmPerDegLng = 111 * Math.cos((centerLat * Math.PI) / 180);
		const half = Math.floor(gridSize / 2);
		for (let i = -half; i <= half; i++) {
			for (let j = -half; j <= half; j++) {
				points.push({
					lat: centerLat + (i * stepKm) / kmPerDegLat,
					lng: centerLng + (j * stepKm) / kmPerDegLng,
				});
			}
		}
		return points;
	}
}
