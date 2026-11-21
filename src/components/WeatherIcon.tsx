import type { WeatherKind } from '../types';

interface WeatherIconProps {
  kind: WeatherKind;
  isDay: boolean;
  size?: number;
}

export function WeatherIcon(props: WeatherIconProps) {
  var size = props.size || 40;
  var kind = props.kind;
  var isDay = props.isDay;

  var sun = (
    <g>
      <circle cx="32" cy="32" r="11" class="wi-sun-core" />
      <g class="wi-sun-rays" stroke-width="2.6" stroke-linecap="round">
        <line x1="32" y1="11" x2="32" y2="15" />
        <line x1="32" y1="49" x2="32" y2="53" />
        <line x1="11" y1="32" x2="15" y2="32" />
        <line x1="49" y1="32" x2="53" y2="32" />
        <line x1="17.2" y1="17.2" x2="20" y2="20" />
        <line x1="44" y1="44" x2="46.8" y2="46.8" />
        <line x1="46.8" y1="17.2" x2="44" y2="20" />
        <line x1="20" y1="44" x2="17.2" y2="46.8" />
      </g>
    </g>
  );

  var moon = (
    <g>
      <path
        d="M38.5 18.5A14 14 0 1 0 46 39.5A11.2 11.2 0 1 1 38.5 18.5Z"
        class="wi-moon"
      />
      <circle cx="44" cy="21" r="1.7" class="wi-star" opacity="0.9" />
      <circle cx="48.5" cy="26.5" r="1.1" class="wi-moon" opacity="0.7" />
    </g>
  );

  var cloudBody = (
    <path
      d="M21 44h24a9 9 0 0 0 1.4-17.9A12 12 0 0 0 23.2 23A8.5 8.5 0 0 0 21 44Z"
      class="wi-cloud"
    />
  );

  var backCloud = (
    <path
      d="M26 35h19a7 7 0 0 0 1.1-13.9A9.5 9.5 0 0 0 27.6 19A6.8 6.8 0 0 0 26 35Z"
      class="wi-cloud-back"
    />
  );

  if (kind === 'clear') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        class="weather-icon"
        aria-hidden="true"
      >
        {isDay ? sun : moon}
      </svg>
    );
  }

  if (kind === 'partly-cloudy') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        class="weather-icon"
        aria-hidden="true"
      >
        {isDay ? (
          <g transform="translate(8, -6) scale(0.76)">{sun}</g>
        ) : (
          <g transform="translate(8, -5) scale(0.78)">{moon}</g>
        )}
        <g transform="translate(-3, 5)">{cloudBody}</g>
      </svg>
    );
  }

  if (kind === 'cloudy') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        class="weather-icon"
        aria-hidden="true"
      >
        <g transform="translate(4, -2)">{backCloud}</g>
        <g transform="translate(-3, 4)">{cloudBody}</g>
      </svg>
    );
  }

  if (kind === 'fog') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        class="weather-icon"
        aria-hidden="true"
      >
        <g transform="translate(-2, -3) scale(0.92)">{cloudBody}</g>
        <g class="wi-fog" stroke-width="2.8" stroke-linecap="round">
          <line x1="14" y1="45" x2="50" y2="45" />
          <line x1="19" y1="51.5" x2="45" y2="51.5" />
        </g>
      </svg>
    );
  }

  if (kind === 'drizzle' || kind === 'rain') {
    var heavy = kind === 'rain';
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        class="weather-icon"
        aria-hidden="true"
      >
        <g transform="translate(-2, -5) scale(0.94)">{cloudBody}</g>
        <g class="wi-rain" stroke-width={heavy ? '2.8' : '2.2'} stroke-linecap="round">
          <line x1="23" y1="43" x2="20" y2={heavy ? '53' : '49'} />
          <line x1="33" y1="43" x2="30" y2={heavy ? '54' : '50'} />
          <line x1="43" y1="43" x2="40" y2={heavy ? '53' : '49'} />
        </g>
      </svg>
    );
  }

  if (kind === 'snow') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        class="weather-icon"
        aria-hidden="true"
      >
        <g transform="translate(-2, -5) scale(0.94)">{cloudBody}</g>
        <g class="wi-snow">
          <circle cx="22" cy="46" r="2.4" />
          <circle cx="32" cy="51" r="2.4" />
          <circle cx="42" cy="46" r="2.4" />
          <circle cx="27" cy="54" r="1.8" opacity="0.8" />
          <circle cx="38" cy="54" r="1.8" opacity="0.8" />
        </g>
      </svg>
    );
  }

  // storm
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      class="weather-icon"
      aria-hidden="true"
    >
      <g transform="translate(-2, -6) scale(0.94)">{cloudBody}</g>
      <path d="M35 39L26 50H32.5L30 58L40 46.5H33.5L35 39Z" class="wi-bolt" />
    </svg>
  );
}
