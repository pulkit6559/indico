/* This file is part of Indico.
 * Copyright (C) 2002 - 2018 European Organization for Nuclear Research (CERN).
 *
 * Indico is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 3 of the
 * License, or (at your option) any later version.
 *
 * Indico is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Indico; if not, see <http://www.gnu.org/licenses/>.
 */

import React from 'react';
import PropTypes from 'prop-types';
import {Button} from 'semantic-ui-react';
import RCCalendar from 'rc-calendar';
import DatePicker from 'rc-calendar/lib/Picker';
import {Translate} from 'indico/react/i18n';
import {toMoment} from 'indico/utils/date';
import {isDateWithinRange} from '../../util';


/**
 * Component that renders a 'mode selector' (day/week/month) and a date picker.
 * This is used in timeline-style views (e.g. 'Book a Room' or 'Calendar').
 */
export default class DateNavigator extends React.Component {
    static propTypes = {
        selectedDate: PropTypes.string.isRequired,
        mode: PropTypes.string.isRequired,
        dateRange: PropTypes.array.isRequired,
        onDateChange: PropTypes.func.isRequired,
        onModeChange: PropTypes.func.isRequired,
        isLoading: PropTypes.bool,
        disabled: PropTypes.bool
    };

    static defaultProps = {
        isLoading: false,
        disabled: false
    };

    constructor(props) {
        super(props);
        const {mode} = this.props;
        this.setDateWithMode(this.selectedDate, mode);
    }

    componentDidUpdate(prevProps) {
        const {mode, selectedDate} = this.props;
        const {mode: prevMode, selectedDate: prevSelectedDate} = prevProps;
        if (prevMode !== mode || prevSelectedDate !== selectedDate) {
            this.setDateWithMode(this.selectedDate, mode);
        }
    }

    /**
     * Get moment representation of prop with the same name
     */
    get selectedDate() {
        const {selectedDate} = this.props;
        return toMoment(selectedDate, 'YYYY-MM-DD');
    }

    /**
     * Get moment representation of the minimum/maximum date values with the
     * current mode. That is beginning/end of week/month the booking starts/ends
     * in.
     */
    get dateBounds() {
        const {dateRange, mode} = this.props;
        if (!dateRange.length) {
            return null;
        }
        return [
            toMoment(dateRange[0], 'YYYY-MM-DD').startOf(mode),
            toMoment(dateRange[dateRange.length - 1], 'YYYY-MM-DD').startOf(mode)
        ];
    }

    /**
     * Set the currently selected date, taking into account the currently
     * selected 'interval mode'. That means rounding down to the first day of
     * the month/week.
     *
     * @param {Moment} date - selected date
     * @param {String} mode - current interval mode (days/weeks/months)
     * @param {Boolean} force - update even if the date didn't really change
     */
    setDateWithMode(date, mode, force = false) {
        const {onDateChange} = this.props;
        let expectedDate;
        if (mode === 'weeks') {
            expectedDate = date.clone().startOf('week');
        } else if (mode === 'months') {
            expectedDate = date.clone().startOf('month');
        } else {
            expectedDate = date.clone();
        }

        if (force || !expectedDate.isSame(date)) {
            onDateChange(expectedDate);
        }
    }

    calendarDisabledDate = (date) => {
        const {dateRange} = this.props;
        if (!date) {
            return false;
        }
        return dateRange.length !== 0 && !isDateWithinRange(date, dateRange, toMoment);
    };

    onSelect = (date) => {
        const {mode, dateRange} = this.props;
        const freeRange = dateRange.length === 0;
        if (freeRange || isDateWithinRange(date, dateRange, toMoment)) {
            if (mode === 'weeks') {
                date = date.clone().startOf('week');
            } else if (mode === 'months') {
                date = date.clone().startOf('month');
            } else {
                date = date.clone();
            }
            this.setDateWithMode(date, mode, true);
        }
    };

    changeSelectedDate = (direction) => {
        const {selectedDate, dateRange, onDateChange, mode} = this.props;
        const step = direction === 'next' ? 1 : -1;

        // dateRange is not set (unlimited)
        if (dateRange.length === 0 || mode !== 'days') {
            onDateChange(this.selectedDate.clone().add(step, mode));
        } else {
            const index = dateRange.findIndex((dt) => dt === selectedDate) + step;
            onDateChange(toMoment(dateRange[index]));
        }
    };

    handleModeChange = (mode) => {
        const {onModeChange} = this.props;
        onModeChange(mode);
        this.setDateWithMode(this.selectedDate, mode);
    };

    renderModeSwitcher(disabled) {
        const {mode} = this.props;
        return !!mode && (
            <Button.Group size="small" style={{marginRight: 10}}>
                <Button content={Translate.string('Day')}
                        onClick={() => this.handleModeChange('days')}
                        primary={mode === 'days'}
                        disabled={disabled} />
                <Button content={Translate.string('Week')}
                        onClick={() => this.handleModeChange('weeks')}
                        primary={mode === 'weeks'}
                        disabled={disabled} />
                <Button content={Translate.string('Month')}
                        onClick={() => this.handleModeChange('months')}
                        primary={mode === 'months'}
                        disabled={disabled} />
            </Button.Group>
        );
    }

    /**
     * Render the DateNavigator, with its prev/next arrows.
     *
     * @param {Boolean} disabled - whether to render the navigator as disabled
     */
    renderNavigator(disabled) {
        const {dateRange, mode} = this.props;
        const startDate = toMoment(dateRange[0]);
        const endDate = toMoment(dateRange[dateRange.length - 1]);

        const calendar = (
            <RCCalendar disabledDate={this.calendarDisabledDate}
                        onChange={this.onSelect}
                        value={this.selectedDate} />
        );
        const prevDisabled = disabled || this.selectedDate.clone().subtract(1, mode).isBefore(startDate);
        const nextDisabled = disabled || this.selectedDate.clone().add(1, mode).isAfter(endDate);

        return (
            <Button.Group size="small">
                <Button icon="left arrow"
                        onClick={() => this.changeSelectedDate('prev')}
                        disabled={prevDisabled} />
                <DatePicker calendar={calendar} disabled={disabled}>
                    {
                        () => (
                            <Button primary>
                                {this.selectedDate.format('L')}
                            </Button>
                        )
                    }
                </DatePicker>
                <Button icon="right arrow"
                        onClick={() => this.changeSelectedDate('next')}
                        disabled={nextDisabled} />
            </Button.Group>
        );
    }

    render = () => {
        const {disabled, isLoading} = this.props;
        return (
            <div>
                {this.renderModeSwitcher(disabled || isLoading)}
                {this.renderNavigator(disabled || isLoading)}
            </div>
        );
    };
}