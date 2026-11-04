--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Ubuntu 17.11-1.pgdg24.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: alert_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_status AS ENUM (
    'new',
    'acknowledged'
);


--
-- Name: event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.event_type AS ENUM (
    'hard_brake',
    'rapid_accel',
    'sharp_turn',
    'overspeed',
    'gps_invalid',
    'lane_drift'
);


--
-- Name: risk_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.risk_level AS ENUM (
    'safe',
    'medium',
    'dangerous'
);


--
-- Name: severity_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.severity_level AS ENUM (
    'low',
    'medium',
    'high'
);


--
-- Name: trip_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trip_status AS ENUM (
    'ongoing',
    'completed',
    'aborted',
    'pending'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    admin_id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    last_login_at timestamp with time zone
);


--
-- Name: admins_admin_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admins_admin_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admins_admin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admins_admin_id_seq OWNED BY public.admins.admin_id;


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    alert_id bigint NOT NULL,
    trip_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    driver_id bigint NOT NULL,
    event_id bigint,
    event_type public.event_type NOT NULL,
    severity public.severity_level NOT NULL,
    message text NOT NULL,
    status public.alert_status DEFAULT 'new'::public.alert_status NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    is_read boolean DEFAULT false
);


--
-- Name: alerts_alert_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alerts_alert_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alerts_alert_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alerts_alert_id_seq OWNED BY public.alerts.alert_id;


--
-- Name: aqi_daily_grid; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aqi_daily_grid (
    id integer NOT NULL,
    grid_date date NOT NULL,
    cell_lat numeric(7,2) NOT NULL,
    cell_lng numeric(7,2) NOT NULL,
    aqi_value numeric NOT NULL,
    pollutant text DEFAULT 'NO2'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aqi_daily_grid_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.aqi_daily_grid_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: aqi_daily_grid_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.aqi_daily_grid_id_seq OWNED BY public.aqi_daily_grid.id;


--
-- Name: aqi_daily_threshold; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aqi_daily_threshold (
    grid_date date NOT NULL,
    pollutant text DEFAULT 'NO2'::text NOT NULL,
    high_threshold numeric NOT NULL,
    medium_threshold numeric
);


--
-- Name: aqi_station_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aqi_station_cache (
    station_uid bigint NOT NULL,
    name text,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    aqi smallint,
    pm25 double precision,
    station_time timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: driver_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_events (
    event_id bigint NOT NULL,
    trip_id bigint NOT NULL,
    telemetry_id bigint,
    event_type public.event_type NOT NULL,
    severity public.severity_level NOT NULL,
    metric_value jsonb,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: driver_events_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.driver_events_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: driver_events_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.driver_events_event_id_seq OWNED BY public.driver_events.event_id;


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drivers (
    driver_id bigint NOT NULL,
    full_name text NOT NULL,
    phone_number text,
    license_number text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email text,
    password_hash text,
    email_verified boolean DEFAULT false NOT NULL,
    otp_code text,
    otp_expires_at timestamp with time zone,
    avatar_url text,
    otp_attempts integer DEFAULT 0,
    otp_send_count integer DEFAULT 0,
    otp_window_started_at timestamp with time zone
);


--
-- Name: drivers_driver_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.drivers_driver_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: drivers_driver_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.drivers_driver_id_seq OWNED BY public.drivers.driver_id;


--
-- Name: risk_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_scores (
    trip_id bigint NOT NULL,
    lr_risk_score double precision,
    lr_risk_level public.risk_level,
    rf_risk_score double precision,
    rf_risk_level public.risk_level,
    final_risk_score double precision,
    final_risk_level public.risk_level,
    model_version text,
    computed_at timestamp with time zone DEFAULT now()
);


--
-- Name: telemetry_raw; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_raw (
    id bigint NOT NULL,
    trip_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    ts timestamp with time zone NOT NULL,
    latitude double precision,
    longitude double precision,
    position_valid boolean DEFAULT true,
    satellites smallint,
    speed double precision,
    speed_limit double precision,
    accel_x double precision,
    accel_y double precision,
    accel_z double precision,
    brake_intensity double precision,
    heading double precision,
    ignition_status boolean,
    engine_rpm integer,
    battery_level smallint,
    gsm_signal smallint,
    raw_payload jsonb,
    received_at timestamp with time zone DEFAULT now(),
    heading_offset_deg double precision DEFAULT 0
);


--
-- Name: telemetry_raw_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telemetry_raw_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telemetry_raw_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telemetry_raw_id_seq OWNED BY public.telemetry_raw.id;


--
-- Name: trip_aqi_exposure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_aqi_exposure (
    trip_id integer NOT NULL,
    driver_id integer NOT NULL,
    avg_aqi_value numeric,
    high_aqi_minutes numeric,
    total_minutes numeric,
    high_aqi_episode_count integer,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trip_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_summary (
    trip_id bigint NOT NULL,
    duration_seconds integer,
    distance_km double precision,
    avg_speed double precision,
    max_speed double precision,
    max_accel double precision,
    max_brake_intensity double precision,
    hard_brake_count integer DEFAULT 0,
    rapid_accel_count integer DEFAULT 0,
    sharp_turn_count integer DEFAULT 0,
    overspeed_count integer DEFAULT 0,
    overspeed_duration_seconds integer DEFAULT 0,
    hard_brake_per_min double precision,
    rapid_accel_per_min double precision,
    sharp_turn_per_min double precision,
    overspeed_ratio double precision,
    gps_invalid_count integer DEFAULT 0,
    computed_at timestamp with time zone DEFAULT now(),
    lane_drift_count integer DEFAULT 0,
    lane_drift_per_min double precision
);


--
-- Name: trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trips (
    trip_id bigint NOT NULL,
    driver_id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    scenario text,
    status public.trip_status DEFAULT 'ongoing'::public.trip_status NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    driver_rating smallint,
    pickup_latitude double precision,
    pickup_longitude double precision,
    vehicle_ready_at timestamp with time zone,
    demo_mode boolean DEFAULT false NOT NULL,
    dest_latitude double precision,
    dest_longitude double precision,
    avg_pm25 double precision,
    pickup_deadline_at timestamp with time zone,
    ended_reason text,
    timeout_notice_shown boolean DEFAULT false NOT NULL,
    CONSTRAINT driver_rating_range CHECK (((driver_rating >= 1) AND (driver_rating <= 5))),
    CONSTRAINT trips_scenario_check CHECK ((scenario = ANY (ARRAY['safe'::text, 'moderate'::text, 'dangerous'::text, 'manual'::text, 'reposition'::text])))
);


--
-- Name: trips_trip_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trips_trip_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trips_trip_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trips_trip_id_seq OWNED BY public.trips.trip_id;


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    vehicle_id bigint NOT NULL,
    license_plate text NOT NULL,
    model text,
    device_ident text,
    last_latitude double precision,
    last_longitude double precision,
    last_speed double precision,
    last_position_valid boolean,
    last_ignition_status boolean,
    last_telemetry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    assigned_driver_id integer,
    vehicle_type text DEFAULT 'sedan'::text NOT NULL,
    CONSTRAINT vehicles_vehicle_type_check CHECK ((vehicle_type = ANY (ARRAY['sedan'::text, 'truck'::text, 'racecar'::text, 'limousine'::text, 'bus'::text, 'tractor'::text, 'duck'::text, 'tank'::text])))
);


--
-- Name: vehicles_vehicle_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vehicles_vehicle_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vehicles_vehicle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vehicles_vehicle_id_seq OWNED BY public.vehicles.vehicle_id;


--
-- Name: admins admin_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins ALTER COLUMN admin_id SET DEFAULT nextval('public.admins_admin_id_seq'::regclass);


--
-- Name: alerts alert_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts ALTER COLUMN alert_id SET DEFAULT nextval('public.alerts_alert_id_seq'::regclass);


--
-- Name: aqi_daily_grid id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aqi_daily_grid ALTER COLUMN id SET DEFAULT nextval('public.aqi_daily_grid_id_seq'::regclass);


--
-- Name: driver_events event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_events ALTER COLUMN event_id SET DEFAULT nextval('public.driver_events_event_id_seq'::regclass);


--
-- Name: drivers driver_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers ALTER COLUMN driver_id SET DEFAULT nextval('public.drivers_driver_id_seq'::regclass);


--
-- Name: telemetry_raw id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_raw ALTER COLUMN id SET DEFAULT nextval('public.telemetry_raw_id_seq'::regclass);


--
-- Name: trips trip_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips ALTER COLUMN trip_id SET DEFAULT nextval('public.trips_trip_id_seq'::regclass);


--
-- Name: vehicles vehicle_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles ALTER COLUMN vehicle_id SET DEFAULT nextval('public.vehicles_vehicle_id_seq'::regclass);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (admin_id);


--
-- Name: admins admins_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_username_key UNIQUE (username);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (alert_id);


--
-- Name: aqi_daily_grid aqi_daily_grid_grid_date_cell_lat_cell_lng_pollutant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aqi_daily_grid
    ADD CONSTRAINT aqi_daily_grid_grid_date_cell_lat_cell_lng_pollutant_key UNIQUE (grid_date, cell_lat, cell_lng, pollutant);


--
-- Name: aqi_daily_grid aqi_daily_grid_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aqi_daily_grid
    ADD CONSTRAINT aqi_daily_grid_pkey PRIMARY KEY (id);


--
-- Name: aqi_daily_threshold aqi_daily_threshold_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aqi_daily_threshold
    ADD CONSTRAINT aqi_daily_threshold_pkey PRIMARY KEY (grid_date, pollutant);


--
-- Name: aqi_station_cache aqi_station_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aqi_station_cache
    ADD CONSTRAINT aqi_station_cache_pkey PRIMARY KEY (station_uid);


--
-- Name: driver_events driver_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_events
    ADD CONSTRAINT driver_events_pkey PRIMARY KEY (event_id);


--
-- Name: drivers drivers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_email_key UNIQUE (email);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (driver_id);


--
-- Name: risk_scores risk_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_scores
    ADD CONSTRAINT risk_scores_pkey PRIMARY KEY (trip_id);


--
-- Name: telemetry_raw telemetry_raw_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_raw
    ADD CONSTRAINT telemetry_raw_pkey PRIMARY KEY (id);


--
-- Name: trip_aqi_exposure trip_aqi_exposure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_aqi_exposure
    ADD CONSTRAINT trip_aqi_exposure_pkey PRIMARY KEY (trip_id);


--
-- Name: trip_summary trip_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_summary
    ADD CONSTRAINT trip_summary_pkey PRIMARY KEY (trip_id);


--
-- Name: trips trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (trip_id);


--
-- Name: vehicles vehicles_device_ident_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_device_ident_key UNIQUE (device_ident);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (vehicle_id);


--
-- Name: idx_alerts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_status ON public.alerts USING btree (status, occurred_at DESC);


--
-- Name: idx_alerts_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_trip ON public.alerts USING btree (trip_id);


--
-- Name: idx_aqi_daily_grid_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aqi_daily_grid_date ON public.aqi_daily_grid USING btree (grid_date, pollutant);


--
-- Name: idx_driver_events_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_events_trip ON public.driver_events USING btree (trip_id);


--
-- Name: idx_driver_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_events_type ON public.driver_events USING btree (trip_id, event_type);


--
-- Name: idx_telemetry_trip_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_trip_ts ON public.telemetry_raw USING btree (trip_id, ts);


--
-- Name: idx_telemetry_vehicle_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_vehicle_ts ON public.telemetry_raw USING btree (vehicle_id, ts DESC);


--
-- Name: idx_trips_driver_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_driver_id ON public.trips USING btree (driver_id);


--
-- Name: idx_trips_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_status ON public.trips USING btree (status);


--
-- Name: idx_trips_vehicle_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trips_vehicle_id ON public.trips USING btree (vehicle_id);


--
-- Name: idx_vehicles_device_ident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_device_ident ON public.vehicles USING btree (device_ident);


--
-- Name: uq_driver_active_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_driver_active_trip ON public.trips USING btree (driver_id) WHERE ((status = ANY (ARRAY['pending'::public.trip_status, 'ongoing'::public.trip_status])) AND (scenario = 'manual'::text));


--
-- Name: uq_telemetry_vehicle_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_telemetry_vehicle_ts ON public.telemetry_raw USING btree (vehicle_id, ts);


--
-- Name: uq_vehicle_active_trip; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vehicle_active_trip ON public.trips USING btree (vehicle_id) WHERE ((status = ANY (ARRAY['pending'::public.trip_status, 'ongoing'::public.trip_status])) AND (scenario = 'manual'::text));


--
-- Name: alerts alerts_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(driver_id);


--
-- Name: alerts alerts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.driver_events(event_id);


--
-- Name: alerts alerts_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(trip_id);


--
-- Name: alerts alerts_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(vehicle_id);


--
-- Name: driver_events driver_events_telemetry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_events
    ADD CONSTRAINT driver_events_telemetry_id_fkey FOREIGN KEY (telemetry_id) REFERENCES public.telemetry_raw(id);


--
-- Name: driver_events driver_events_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_events
    ADD CONSTRAINT driver_events_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(trip_id);


--
-- Name: risk_scores risk_scores_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_scores
    ADD CONSTRAINT risk_scores_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(trip_id);


--
-- Name: telemetry_raw telemetry_raw_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_raw
    ADD CONSTRAINT telemetry_raw_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(trip_id);


--
-- Name: telemetry_raw telemetry_raw_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_raw
    ADD CONSTRAINT telemetry_raw_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(vehicle_id);


--
-- Name: trip_aqi_exposure trip_aqi_exposure_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_aqi_exposure
    ADD CONSTRAINT trip_aqi_exposure_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(driver_id);


--
-- Name: trip_aqi_exposure trip_aqi_exposure_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_aqi_exposure
    ADD CONSTRAINT trip_aqi_exposure_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(trip_id) ON DELETE CASCADE;


--
-- Name: trip_summary trip_summary_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_summary
    ADD CONSTRAINT trip_summary_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(trip_id);


--
-- Name: trips trips_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(driver_id);


--
-- Name: trips trips_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(vehicle_id);


--
-- Name: vehicles vehicles_assigned_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_assigned_driver_id_fkey FOREIGN KEY (assigned_driver_id) REFERENCES public.drivers(driver_id);


--
-- Name: aqi_station_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aqi_station_cache ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--
